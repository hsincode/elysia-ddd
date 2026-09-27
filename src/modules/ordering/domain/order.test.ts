import { describe, expect, test } from "bun:test";
import { Money } from "#shared/domain/money";
import { type Result, unwrap } from "#shared/domain/result";
import {
  CancelReason,
  CONFIRMATION_DEADLINE_MS,
  CustomerId,
  MAX_ORDER_LINES,
  ORDER_TOTAL_LIMIT,
  ORDER_TRANSITIONS,
  Order,
  type OrderAction,
  OrderId,
  type OrderLine,
  OrderRequest,
  type OrderStatus,
  ProductId,
  Quantity,
  TrackingNumber,
} from "./order";

// ドメイン層は純粋な TypeScript なので、DB もフレームワークも無しで試せる
const placedAt = new Date("2026-04-01T09:00:00Z");
const later = (ms: number) => new Date(placedAt.getTime() + ms);
const reason = unwrap(CancelReason.of("数量を間違えた"));
const tracking = unwrap(TrackingNumber.of("JP1234-5678"));

const line = (productId: string, unitPrice: number, quantity: number): OrderLine => ({
  productId: ProductId(productId),
  productName: `商品 ${productId}`,
  unitPrice: unwrap(Money.of(unitPrice)),
  quantity: unwrap(Quantity.of(quantity)),
});

const place = (lines: OrderLine[]) =>
  Order.place({ id: OrderId("order-1"), customerId: CustomerId("customer-1"), lines, now: placedAt });

const placed = () => unwrap(place([line("a", 1200, 2), line("b", 300, 1)])).order;

/** 各状態の注文を作る（遷移表のテスト用） */
const orderIn = (status: OrderStatus): Order => {
  const order = placed();
  switch (status) {
    case "placed":
      return order;
    case "confirmed":
      return unwrap(order.confirm(later(1))).order;
    case "shipped":
      return unwrap(unwrap(order.confirm(later(1))).order.ship(tracking, later(2))).order;
    case "cancelled":
      return unwrap(order.cancel(reason, later(1))).order;
    case "rejected":
      return unwrap(order.reject([ProductId("a")], later(1))).order;
  }
};

const perform = (order: Order, action: OrderAction) => {
  switch (action) {
    case "confirm":
      return order.confirm(later(10));
    case "reject":
      return order.reject([ProductId("a")], later(10));
    case "expire":
      return order.expire(later(CONFIRMATION_DEADLINE_MS));
    case "cancel":
      return order.cancel(reason, later(10));
    case "ship":
      return order.ship(tracking, later(10));
  }
};

/** Err の中身を素の値として取り出す（ブランド型のままだと素のリテラルと比べられないため） */
const errorOf = (result: Result<unknown, unknown>): unknown => {
  if (result.ok) throw new Error("expected Err, got Ok");
  return result.error;
};

describe("Order.place", () => {
  test("合計を計算し、確保待ち（placed）で OrderPlaced を返す", () => {
    const { order, event } = unwrap(place([line("a", 1200, 2), line("b", 300, 1)]));
    expect<number>(order.total).toBe(2700);
    expect(order.state).toEqual({ status: "placed" });
    expect(event).toEqual({
      type: "ordering.OrderPlaced",
      aggregateId: "order-1",
      occurredAt: placedAt,
      payload: {
        customerId: "customer-1",
        total: 2700,
        lines: [
          { productId: "a", quantity: 2, unitPrice: 1200 },
          { productId: "b", quantity: 1, unitPrice: 300 },
        ],
      },
    });
  });

  test("明細が空・多すぎる・同じ商品が 2 行、はどれも受け付けない", () => {
    expect(errorOf(place([]))).toEqual({ type: "EmptyOrder" });
    const many = Array.from({ length: MAX_ORDER_LINES + 1 }, (_, i) => line(`p${i}`, 1, 1));
    expect(errorOf(place(many))).toEqual({ type: "TooManyOrderLines", count: 51, limit: 50 });
    expect(place(many.slice(0, MAX_ORDER_LINES)).ok).toBe(true);
    expect(errorOf(place([line("a", 100, 1), line("a", 100, 2)]))).toEqual({
      type: "DuplicateOrderLine",
      productId: "a",
    });
  });

  test("合計が上限ちょうどなら注文でき、1 円でも超えれば OrderTotalLimitExceeded", () => {
    expect(place([line("a", ORDER_TOTAL_LIMIT, 1)]).ok).toBe(true);
    expect(errorOf(place([line("a", ORDER_TOTAL_LIMIT, 1), line("b", 1, 1)]))).toEqual({
      type: "OrderTotalLimitExceeded",
      total: 1_000_001,
      limit: 1_000_000,
    });
  });
});

describe("OrderRequest.parse（カタログに問い合わせる前の検査）", () => {
  test("明細の数・重複・数量をまとめて確かめる", () => {
    expect(OrderRequest.parse([{ productId: "a", quantity: 2 }]).ok).toBe(true);
    expect(errorOf(OrderRequest.parse([]))).toEqual({ type: "EmptyOrder" });
    expect(errorOf(OrderRequest.parse([{ productId: "a", quantity: 0 }]))).toEqual({
      type: "InvalidQuantity",
      quantity: 0,
      productId: "a",
    });
  });
});

describe("状態遷移", () => {
  const statuses: OrderStatus[] = ["placed", "confirmed", "shipped", "cancelled", "rejected"];
  const actions: OrderAction[] = ["confirm", "reject", "expire", "cancel", "ship"];

  // 5 状態 × 5 操作のすべてで、遷移表どおりに通るか断られるかを確かめる
  for (const status of statuses) {
    for (const action of actions) {
      const allowed = (ORDER_TRANSITIONS[status] as readonly OrderAction[]).includes(action);
      test(`${status} で ${action} は${allowed ? "できる" : "できない"}`, () => {
        const result = perform(orderIn(status), action);
        if (allowed) expect(result.ok).toBe(true);
        else {
          expect(errorOf(result)).toEqual({
            type: "InvalidOrderTransition",
            orderId: "order-1",
            action,
            currentStatus: status,
          });
        }
      });
    }
  }

  test("状態を変えても元の Order は書き換わらない", () => {
    const order = placed();
    unwrap(order.confirm(later(1)));
    expect(order.state).toEqual({ status: "placed" });
  });

  test("確定後の取消は、確保していたこと（confirmedAt）を覚えている", () => {
    expect(unwrap(orderIn("confirmed").cancel(reason, later(5))).order.state).toMatchObject({
      status: "cancelled",
      cancelledBy: "customer",
      confirmedAt: later(1),
    });
    expect(unwrap(placed().cancel(reason, later(5))).order.state).toMatchObject({ confirmedAt: null });
  });

  test("出荷のイベントは明細を運び、出荷後にできる操作は無い", () => {
    const { order, event } = unwrap(orderIn("confirmed").ship(tracking, later(2)));
    expect(order.state).toEqual({
      status: "shipped",
      confirmedAt: later(1),
      shippedAt: later(2),
      trackingNumber: tracking,
    });
    expect(event.payload.lines).toHaveLength(2);
    expect(order.availableActions).toEqual([]);
  });
});

describe("期限切れ（expire）", () => {
  test("期限の 1 ミリ秒前は取り消せず、期限ちょうどからシステムが取り消せる", () => {
    const order = placed();
    expect(errorOf(order.expire(later(CONFIRMATION_DEADLINE_MS - 1)))).toMatchObject({
      type: "ConfirmationNotOverdue",
    });
    const { order: expired, event } = unwrap(order.expire(later(CONFIRMATION_DEADLINE_MS)));
    expect(expired.state).toMatchObject({ status: "cancelled", cancelledBy: "system", confirmedAt: null });
    expect(event.payload.cancelledBy).toBe("system");
  });
});

describe("値オブジェクト", () => {
  test.each([1, 99])("数量 %p は受け付ける", (value) => {
    expect(Quantity.of(value).ok).toBe(true);
  });

  test.each([0, 100, 1.5, -1, Number.NaN])("数量 %p は受け付けない", (value) => {
    expect(Quantity.of(value).ok).toBe(false);
  });

  test("取消の理由は正規化して、見た目の文字数で数える（改行は可、他の制御文字は不可）", () => {
    expect<string>(unwrap(CancelReason.of("　がん　"))).toBe("がん");
    expect(CancelReason.of("👨‍👩‍👧".repeat(200)).ok).toBe(true);
    expect(CancelReason.of("👨‍👩‍👧".repeat(201)).ok).toBe(false);
    expect(CancelReason.of("1 行目\n2 行目").ok).toBe(true);
    expect(CancelReason.of("タブ\tは不可").ok).toBe(false);
    expect(CancelReason.of("   ").ok).toBe(false);
  });

  test("追跡番号は全角を半角に、英字を大文字にそろえる", () => {
    expect<string>(unwrap(TrackingNumber.of("ｊｐ１２３４－５６７８"))).toBe("JP1234-5678");
    expect(TrackingNumber.of("-JP12345").ok).toBe(false);
    expect(TrackingNumber.of("短い").ok).toBe(false);
  });
});
