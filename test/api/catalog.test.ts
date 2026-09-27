import { afterAll, describe, expect, test } from "bun:test";
import { dataOf, startTestSystem } from "#test/support/test-system";

const system = await startTestSystem();
const { api } = system;
afterAll(() => system.close());

describe("POST /products", () => {
  test("登録すると 201 と Location を返す（商品名の前後の空白は Value Object が落とす）", async () => {
    const { data, status, response } = await api.products.post({ name: "  コーヒー豆  ", price: 1200 });
    expect(status).toBe(201);
    expect(data).toMatchObject({ name: "コーヒー豆", price: 1200, status: "on_sale", unitsSold: 0 });
    expect(response.headers.get("location")).toBe(`/products/${data?.id}`);
  });

  test("業務ルール違反は 422 の Problem Details", async () => {
    const { error } = await api.products.post({ name: "   ", price: 100 });
    expect(error?.status).toBe(422);
    expect(error?.value).toMatchObject({ type: "urn:problem:InvalidProductName", title: "Invalid product name" });
  });

  test("形の合わない入力は 400 で、ユースケースまで届かない", async () => {
    // 400 はルートではなく共通のエラーハンドラーが返すので、Eden の型には載らない。生の Response で確かめる
    const { error, response } = await api.products.post({ name: "紅茶", price: "free" as unknown as number });
    expect(response.status).toBe(400);
    expect(error?.value).toMatchObject({ title: "Invalid request", errors: [{ path: "/price" }] });
  });
});

describe("GET /products/:id", () => {
  test("無ければ 404", async () => {
    const { error } = await api.products({ id: "01900000-0000-7000-8000-0000000000ff" }).get();
    expect(error?.status).toBe(404);
    expect(error?.value).toMatchObject({ type: "urn:problem:ProductNotFound" });
  });
});

describe("POST /products/:id/discontinue", () => {
  test("販売を終了できるのは 1 回だけ（2 回目は 409）", async () => {
    const product = dataOf(await api.products.post({ name: "限定ブレンド", price: 1500 }));
    const first = await api.products({ id: product.id }).discontinue.post();
    expect(first.data?.status).toBe("discontinued");
    const second = await api.products({ id: product.id }).discontinue.post();
    expect(second.error?.status).toBe(409);
    expect(second.error?.value).toMatchObject({ type: "urn:problem:ProductAlreadyDiscontinued" });
  });
});
