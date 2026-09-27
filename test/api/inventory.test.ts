import { afterAll, describe, expect, test } from "bun:test";
import { dataOf, startTestSystem } from "#test/support/test-system";

const system = await startTestSystem();
const { api } = system;
afterAll(() => system.close());

const unknownProduct = "01900000-0000-7000-8000-0000000000ff";
const register = async (name: string) => dataOf(await api.products.post({ name, price: 1000 }));

describe("GET /inventory/:productId", () => {
  test("カタログにあって一度も入荷していない商品は 0、カタログに無い商品は 404", async () => {
    const product = await register("新商品");
    expect(dataOf(await api.inventory({ productId: product.id }).get())).toEqual({
      productId: product.id,
      onHand: 0,
      reserved: 0,
      available: 0,
    });
    expect((await api.inventory({ productId: unknownProduct }).get()).error?.status).toBe(404);
  });
});

describe("POST /inventory/:productId/receipts", () => {
  test("入荷した数だけ増え、同じ Idempotency-Key の再送は数えない", async () => {
    const product = await register("焙煎豆");
    const receipt = api.inventory({ productId: product.id }).receipts;
    const headers = { "idempotency-key": `receipt-${Bun.randomUUIDv7()}` };
    expect(dataOf(await receipt.post({ quantity: 10 }, { headers })).onHand).toBe(10);
    const retry = await receipt.post({ quantity: 10 }, { headers });
    expect(retry.data?.onHand).toBe(10);
    expect(retry.response.headers.get("idempotent-replayed")).toBe("true");
    expect(dataOf(await receipt.post({ quantity: 5 })).onHand).toBe(15);
  });

  test("初めての入荷が同時に来ても、両方とも数える", async () => {
    const product = await register("新豆");
    const receipt = api.inventory({ productId: product.id }).receipts;
    await Promise.all([receipt.post({ quantity: 3 }), receipt.post({ quantity: 4 })]);
    expect(dataOf(await api.inventory({ productId: product.id }).get()).onHand).toBe(7);
  });

  test("数量 0・上限超え・カタログに無い商品は断る", async () => {
    const product = await register("生豆");
    const receipt = api.inventory({ productId: product.id }).receipts;
    expect((await receipt.post({ quantity: 0 })).error?.value).toMatchObject({ type: "urn:problem:InvalidQuantity" });
    await receipt.post({ quantity: 1_000_000 });
    expect((await receipt.post({ quantity: 1 })).error?.value).toMatchObject({
      type: "urn:problem:StockLimitExceeded",
      limit: 1_000_000,
    });
    const unknown = await api.inventory({ productId: unknownProduct }).receipts.post({ quantity: 1 });
    expect(unknown.error?.status).toBe(404);
  });
});
