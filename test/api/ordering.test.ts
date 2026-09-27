import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { dataOf, startTestSystem } from "#test/support/test-system";

const system = await startTestSystem();
const { api, relay, clock } = system;
afterAll(() => system.close());
// 前のテストが配送しないまま終わったイベントを持ち越さない
beforeEach(async () => {
  await relay.drain();
});

const customerId = "01900000-0000-7000-8000-00000000c001";
const MINUTE_MS = 60_000;
/** 冪等キーは実行ごとに変える（実 PostgreSQL の DB は前回のテストの記録を持っている） */
const keyFor = (name: string) => ({ "idempotency-key": `${name}-${Bun.randomUUIDv7()}` });

/** カタログに登録し、quantity 個入荷した商品 */
const stockedProduct = async (name: string, price: number, quantity: number) => {
  const product = dataOf(await api.products.post({ name, price }));
  if (quantity > 0) dataOf(await api.inventory({ productId: product.id }).receipts.post({ quantity }));
  return product;
};
const placeOrder = async (lines: { productId: string; quantity: number }[]) =>
  dataOf(await api.orders.post({ customerId, lines }));
const orderOf = async (id: string) => dataOf(await api.orders({ id }).get());
const stockOf = async (productId: string) => dataOf(await api.inventory({ productId }).get());

describe("注文から出荷まで（在庫コンテキストとの Saga）", () => {
  test("在庫を確保できれば確定し、出荷すると在庫が減って販売数が増える", async () => {
    const beans = await stockedProduct("コーヒー豆", 1200, 5);
    const placed = await placeOrder([{ productId: beans.id, quantity: 2 }]);
    expect(placed).toMatchObject({ status: "placed", total: 2400, actions: ["cancel"] });

    // OrderPlaced → 引当 → StockReserved → 確定 → OrderConfirmed までが 1 回の drain で流れる
    expect(await relay.drain()).toBe(3);
    expect(await orderOf(placed.id)).toMatchObject({ status: "confirmed", actions: ["ship", "cancel"] });
    expect(await stockOf(beans.id)).toMatchObject({ onHand: 5, reserved: 2, available: 3 });

    const shipped = dataOf(await api.orders({ id: placed.id }).ship.post({ trackingNumber: "ｊｐ１２３４－５６７８" }));
    expect(shipped).toMatchObject({ status: "shipped", shipment: { trackingNumber: "JP1234-5678" }, actions: [] });
    await relay.drain();
    expect(await stockOf(beans.id)).toMatchObject({ onHand: 3, reserved: 0, available: 3 });
    expect(dataOf(await api.products({ id: beans.id }).get()).unitsSold).toBe(2);
  });

  test("在庫が足りなければ却下し、在庫は動かさない", async () => {
    const tea = await stockedProduct("紅茶", 800, 1);
    const placed = await placeOrder([{ productId: tea.id, quantity: 2 }]);
    await relay.drain();
    expect(await orderOf(placed.id)).toMatchObject({
      status: "rejected",
      rejection: { unavailableProductIds: [tea.id] },
      actions: [],
    });
    expect(await stockOf(tea.id)).toMatchObject({ onHand: 1, reserved: 0 });
  });

  test("最後の 1 個を 2 件の注文が取り合っても、確定するのは 1 件だけ", async () => {
    const last = await stockedProduct("限定ブレンド", 3000, 1);
    const orders = await Promise.all([
      placeOrder([{ productId: last.id, quantity: 1 }]),
      placeOrder([{ productId: last.id, quantity: 1 }]),
    ]);
    await relay.drain();
    const statuses = await Promise.all(orders.map(async (order) => (await orderOf(order.id)).status));
    expect(statuses.sort()).toEqual(["confirmed", "rejected"]);
    expect(await stockOf(last.id)).toMatchObject({ onHand: 1, reserved: 1, available: 0 });
  });

  test("確定後に取り消すと、引き当てていた在庫が戻る", async () => {
    const mugs = await stockedProduct("マグカップ", 1500, 3);
    const placed = await placeOrder([{ productId: mugs.id, quantity: 3 }]);
    await relay.drain();
    const cancelled = dataOf(await api.orders({ id: placed.id }).cancel.post({ reason: "色を間違えた" }));
    expect(cancelled).toMatchObject({ status: "cancelled", cancellation: { by: "customer", reason: "色を間違えた" } });
    expect(cancelled.confirmedAt).toBeInstanceOf(Date);
    await relay.drain();
    expect(await stockOf(mugs.id)).toMatchObject({ reserved: 0, available: 3 });
  });

  test("確保待ちのうちに取り消しても、在庫は最終的に元どおりになる", async () => {
    const filters = await stockedProduct("ペーパーフィルター", 400, 10);
    const placed = await placeOrder([{ productId: filters.id, quantity: 4 }]);
    // 在庫の引当より先に取り消す。在庫には「引当 → 取消」、注文には「取消のあとに確保済みの知らせ」の順で届く
    dataOf(await api.orders({ id: placed.id }).cancel.post({ reason: "急ぎでなくなった" }));
    await relay.drain();
    expect(await orderOf(placed.id)).toMatchObject({ status: "cancelled", confirmedAt: null });
    expect(await stockOf(filters.id)).toMatchObject({ reserved: 0, available: 10 });
  });

  test("確保待ちのまま 15 分過ぎた注文は、期限切れとしてシステムが取り消す", async () => {
    const mill = await stockedProduct("手挽きミル", 5000, 2);
    const placed = await placeOrder([{ productId: mill.id, quantity: 1 }]);
    // 在庫の知らせが届かないまま（配送しないまま）時間が過ぎる
    clock.advance(15 * MINUTE_MS - 1);
    await system.runJob("ordering.expire-overdue-orders");
    expect((await orderOf(placed.id)).status).toBe("placed");
    clock.advance(1);
    await system.runJob("ordering.expire-overdue-orders");
    expect(await orderOf(placed.id)).toMatchObject({ status: "cancelled", cancellation: { by: "system" } });

    // 遅れて流れた引当は取消で戻り、確保済みの知らせは無視される
    await relay.drain();
    expect((await orderOf(placed.id)).status).toBe("cancelled");
    expect(await stockOf(mill.id)).toMatchObject({ reserved: 0, available: 2 });
  });
});

describe("Idempotency-Key", () => {
  test("同じキーでやり直しても注文は 1 件だけで、前回と同じ応答が返る", async () => {
    const product = await stockedProduct("水出しパック", 900, 5);
    const body = { customerId, lines: [{ productId: product.id, quantity: 1 }] };
    const headers = keyFor("retry");
    const first = await api.orders.post(body, { headers });
    const retry = await api.orders.post(body, { headers });
    expect(retry.status).toBe(201);
    expect(retry.data?.id).toBe(first.data?.id as string);
    expect(retry.response.headers.get("idempotent-replayed")).toBe("true");
    expect(retry.response.headers.get("location")).toBe(`/orders/${first.data?.id}`);
    // 注文が 1 件なら、配送されるのは OrderPlaced・StockReserved・OrderConfirmed の 3 件
    expect(await relay.drain()).toBe(3);
  });

  test("同じキーの同時リクエストでも、注文は 1 件だけ", async () => {
    const product = await stockedProduct("ドリップバッグ", 150, 5);
    const body = { customerId, lines: [{ productId: product.id, quantity: 1 }] };
    const headers = keyFor("concurrent");
    const [a, b] = await Promise.all([api.orders.post(body, { headers }), api.orders.post(body, { headers })]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.data?.id).toBe(b.data?.id as string);
    expect(await relay.drain()).toBe(3);
  });

  test("同じキーで違うボディを送ると 422", async () => {
    const product = await stockedProduct("カフェインレス", 1100, 5);
    const headers = keyFor("mismatch");
    await api.orders.post({ customerId, lines: [{ productId: product.id, quantity: 1 }] }, { headers });
    const other = await api.orders.post({ customerId, lines: [{ productId: product.id, quantity: 2 }] }, { headers });
    expect(other.error?.status).toBe(422);
    expect(other.error?.value).toMatchObject({ type: "urn:problem:IdempotencyKeyReused" });
    await relay.drain();
  });
});

describe("操作できない状態と、入力の端", () => {
  test("確定前の出荷は 409 で、何ができないのかを返す", async () => {
    const product = await stockedProduct("サーバー", 2500, 1);
    const placed = await placeOrder([{ productId: product.id, quantity: 1 }]);
    const { error } = await api.orders({ id: placed.id }).ship.post({ trackingNumber: "JP1234-5678" });
    expect(error?.status).toBe(409);
    expect(error?.value).toMatchObject({
      type: "urn:problem:InvalidOrderTransition",
      status: 409,
      action: "ship",
      currentStatus: "placed",
    });
    await relay.drain();
  });

  test("明細が 51 行ある注文は、カタログを引く前に 422", async () => {
    const lines = Array.from({ length: 51 }, (_, i) => ({
      productId: `01900000-0000-7000-8000-${i.toString(16).padStart(12, "0")}`,
      quantity: 1,
    }));
    const { error } = await api.orders.post({ customerId, lines });
    expect(error?.value).toMatchObject({ type: "urn:problem:TooManyOrderLines", count: 51, limit: 50 });
  });

  test("取消の理由が空白だけ・追跡番号が短すぎる、はどちらも 422", async () => {
    const product = await stockedProduct("スケール", 4000, 1);
    const placed = await placeOrder([{ productId: product.id, quantity: 1 }]);
    const cancel = await api.orders({ id: placed.id }).cancel.post({ reason: " 　 " });
    expect(cancel.error?.value).toMatchObject({ type: "urn:problem:InvalidCancelReason" });
    await relay.drain();
    const ship = await api.orders({ id: placed.id }).ship.post({ trackingNumber: "JP1" });
    expect(ship.error?.value).toMatchObject({ type: "urn:problem:InvalidTrackingNumber" });
  });

  test("同じ注文を同時に 2 回取り消しても、通るのは 1 回だけ（もう一方は 409）", async () => {
    const product = await stockedProduct("デカフェ", 900, 1);
    const placed = await placeOrder([{ productId: product.id, quantity: 1 }]);
    const results = await Promise.all([
      api.orders({ id: placed.id }).cancel.post({ reason: "A" }),
      api.orders({ id: placed.id }).cancel.post({ reason: "B" }),
    ]);
    expect(results.map((result) => result.response.status).sort()).toEqual([200, 409]);
    await relay.drain();
  });

  test("存在しない注文は 404", async () => {
    const { error } = await api.orders({ id: "01900000-0000-7000-8000-0000000000ff" }).cancel.post({ reason: "x" });
    expect(error?.status).toBe(404);
    expect(error?.value).toMatchObject({ type: "urn:problem:OrderNotFound" });
  });
});
