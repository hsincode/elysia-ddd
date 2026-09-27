import { describe, expect, test } from "bun:test";
import { unwrap } from "#shared/domain/result";
import { allocate } from "./allocation";
import { OrderId, type ReservationLine } from "./reservation";
import { MAX_ON_HAND, ProductId, Quantity, StockItem } from "./stock-item";

const now = new Date("2026-04-01T09:00:00Z");
const orderId = OrderId("order-1");
const q = (n: number) => unwrap(Quantity.of(n));
const line = (productId: string, quantity: number): ReservationLine => ({
  productId: ProductId(productId),
  quantity: q(quantity),
});

/** onHand 個入荷済み・reserved 個引当済みの在庫 */
const stockOf = (productId: string, onHand: number, reserved = 0) =>
  StockItem.reconstitute({ productId: ProductId(productId), onHand, reserved, version: 1 });

const stockMap = (...items: StockItem[]) => new Map(items.map((item) => [item.productId, item]));

describe("StockItem", () => {
  test("引当は available（onHand − reserved）の範囲まで", () => {
    const item = stockOf("a", 5, 3);
    expect(item.available).toBe(2);
    expect(unwrap(item.reserve(q(2))).available).toBe(0);
    expect(item.reserve(q(3))).toEqual({
      ok: false,
      error: { type: "InsufficientStock", productId: ProductId("a"), requested: 3, available: 2 },
    });
  });

  test("戻すと reserved が減り、出荷すると onHand と reserved が両方減る", () => {
    const item = stockOf("a", 5, 3);
    expect(item.release(q(3))).toMatchObject({ onHand: 5, reserved: 0 });
    expect(item.fulfill(q(2))).toMatchObject({ onHand: 3, reserved: 1 });
  });

  test("引き当てた以上を戻す・出荷するのはバグなので投げる", () => {
    expect(() => stockOf("a", 5, 1).release(q(2))).toThrow();
    expect(() => stockOf("a", 5, 1).fulfill(q(2))).toThrow();
  });

  test("入荷は上限まで", () => {
    expect(unwrap(stockOf("a", MAX_ON_HAND - 1).receive(q(1))).onHand).toBe(MAX_ON_HAND);
    expect(stockOf("a", MAX_ON_HAND).receive(q(1))).toMatchObject({ ok: false, error: { type: "StockLimitExceeded" } });
  });
});

describe("allocate（全部引き当てるか、何も引き当てないか）", () => {
  test("すべて足りれば、全商品を引き当てて StockReserved", () => {
    const result = allocate({
      orderId,
      now,
      lines: [line("a", 2), line("b", 1)],
      stock: stockMap(stockOf("a", 2), stockOf("b", 5)),
    });
    expect(result.outcome).toBe("reserved");
    if (result.outcome !== "reserved") return;
    expect(result.items.map((item) => `${item.productId}:${item.reserved}`)).toEqual(["a:2", "b:1"]);
    expect(result.reservation.status).toBe("reserved");
    expect(result.event).toEqual({
      type: "inventory.StockReserved",
      aggregateId: orderId,
      occurredAt: now,
      payload: { orderId },
    });
  });

  test("1 つでも足りなければ、何も引き当てずに不足をすべて報告する", () => {
    const result = allocate({
      orderId,
      now,
      lines: [line("a", 2), line("b", 9), line("never-received", 1)],
      stock: stockMap(stockOf("a", 5), stockOf("b", 5)),
    });
    expect(result.outcome).toBe("rejected");
    if (result.outcome !== "rejected") return;
    expect(result.shortages).toEqual([
      { productId: "b", requested: 9, available: 5 },
      { productId: "never-received", requested: 1, available: 0 },
    ]);
    expect(result.reservation.status).toBe("rejected");
    expect(result.reservation.lines).toEqual([]);
  });

  test("同じ商品が複数行あれば合算して判断する", () => {
    const result = allocate({ orderId, now, lines: [line("a", 2), line("a", 2)], stock: stockMap(stockOf("a", 3)) });
    expect(result.outcome).toBe("rejected");
    expect(result.outcome === "rejected" && result.shortages).toEqual([{ productId: "a", requested: 4, available: 3 }]);
  });
});
