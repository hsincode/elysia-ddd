import type { Brand } from "#shared/domain/brand";
import { Money } from "#shared/domain/money";
import { err, ok, type Result, unwrap } from "#shared/domain/result";
import { graphemeLength, hasControlCharacters, normalizeText } from "#shared/domain/text";
import type {
  OrderCancelled,
  OrderConfirmed,
  OrderLineSnapshot,
  OrderPlaced,
  OrderRejected,
  OrderShipped,
} from "./order-events";

export type OrderId = Brand<string, "OrderId">;
export const OrderId = (value: string) => value as OrderId;

export type CustomerId = Brand<string, "CustomerId">;
export const CustomerId = (value: string) => value as CustomerId;

/** 注文から見た商品の ID。カタログの ProductId とは別の型にする（コンテキストをまたいで型を共有しない） */
export type ProductId = Brand<string, "ProductId">;
export const ProductId = (value: string) => value as ProductId;

/** 1 注文に入れられる明細の数 */
export const MAX_ORDER_LINES = 50;
/** 1 注文の上限金額。明細をまたいで成り立つべき条件なので集約ルートが守る */
export const ORDER_TOTAL_LIMIT = 1_000_000 as Money;
/** 在庫の確保を待つ時間。過ぎても確定しない注文は期限切れとして取り消す */
export const CONFIRMATION_DEADLINE_MS = 15 * 60 * 1000;

// ---- 値オブジェクト ----

const MAX_QUANTITY = 99;

/** 1 明細あたりの数量（1〜99） */
export type Quantity = Brand<number, "Quantity">;
export type InvalidQuantity = { readonly type: "InvalidQuantity"; readonly quantity: number };
export const Quantity = {
  of(value: number): Result<Quantity, InvalidQuantity> {
    return Number.isInteger(value) && value >= 1 && value <= MAX_QUANTITY
      ? ok(value as Quantity)
      : err({ type: "InvalidQuantity", quantity: value });
  },
};

const MAX_REASON_LENGTH = 200;

/** 取消の理由（見た目の文字数で 1〜200、改行は可） */
export type CancelReason = Brand<string, "CancelReason">;
export type InvalidCancelReason = { readonly type: "InvalidCancelReason"; readonly reason: string };
export const CancelReason = {
  of(raw: string): Result<CancelReason, InvalidCancelReason> {
    const reason = normalizeText(raw);
    const length = graphemeLength(reason);
    return length >= 1 && length <= MAX_REASON_LENGTH && !hasControlCharacters(reason, { allowNewline: true })
      ? ok(reason as CancelReason)
      : err({ type: "InvalidCancelReason", reason: raw });
  },
};

/**
 * 配送の追跡番号。全角の英数字・ハイフンは NFKC で半角にし、英字は大文字にそろえる
 * （「ｊｐ１２３４－５６７８」と「JP1234-5678」を同じ番号として扱う）。
 */
export type TrackingNumber = Brand<string, "TrackingNumber">;
export type InvalidTrackingNumber = { readonly type: "InvalidTrackingNumber"; readonly trackingNumber: string };
export const TrackingNumber = {
  of(raw: string): Result<TrackingNumber, InvalidTrackingNumber> {
    const value = raw.normalize("NFKC").trim().toUpperCase();
    return /^[A-Z0-9][A-Z0-9-]{6,28}[A-Z0-9]$/.test(value)
      ? ok(value as TrackingNumber)
      : err({ type: "InvalidTrackingNumber", trackingNumber: raw });
  },
};

// ---- 明細と注文の依頼 ----

/** 明細。単価と商品名は注文した時点の値を写し取り、あとでカタログが変わっても変えない */
export type OrderLine = Readonly<{ productId: ProductId; productName: string; unitPrice: Money; quantity: Quantity }>;

export type EmptyOrder = { readonly type: "EmptyOrder" };
export type TooManyOrderLines = { readonly type: "TooManyOrderLines"; readonly count: number; readonly limit: number };
export type DuplicateOrderLine = { readonly type: "DuplicateOrderLine"; readonly productId: ProductId };
export type InvalidLineQuantity = InvalidQuantity & { readonly productId: string };

const checkLines = (
  productIds: readonly ProductId[],
): Result<void, EmptyOrder | TooManyOrderLines | DuplicateOrderLine> => {
  if (productIds.length === 0) return err({ type: "EmptyOrder" });
  if (productIds.length > MAX_ORDER_LINES) {
    return err({ type: "TooManyOrderLines", count: productIds.length, limit: MAX_ORDER_LINES });
  }
  const seen = new Set<ProductId>();
  for (const productId of productIds) {
    if (seen.has(productId)) return err({ type: "DuplicateOrderLine", productId });
    seen.add(productId);
  }
  return ok();
};

export type RequestedLine = Readonly<{ productId: ProductId; quantity: Quantity }>;

/**
 * 注文の依頼（商品と数量だけ）。価格を引く前に確かめられる条件はここで確かめ、
 * 明細が 1 万行あるような依頼でカタログに問い合わせないようにする。
 */
export const OrderRequest = {
  parse(
    lines: readonly Readonly<{ productId: string; quantity: number }>[],
  ): Result<RequestedLine[], EmptyOrder | TooManyOrderLines | DuplicateOrderLine | InvalidLineQuantity> {
    const checked = checkLines(lines.map((line) => ProductId(line.productId)));
    if (!checked.ok) return checked;
    const requested: RequestedLine[] = [];
    for (const line of lines) {
      const quantity = Quantity.of(line.quantity);
      if (!quantity.ok) return err({ ...quantity.error, productId: line.productId });
      requested.push({ productId: ProductId(line.productId), quantity: quantity.value });
    }
    return ok(requested);
  },
};

// ---- 状態と状態遷移 ----

export type CancelledBy = "customer" | "system";

/** 状態ごとに持てる値を型で分け、「出荷済みなのに追跡番号が無い」のような状態を作れなくする */
export type OrderState =
  | Readonly<{ status: "placed" }>
  | Readonly<{ status: "confirmed"; confirmedAt: Date }>
  | Readonly<{ status: "shipped"; confirmedAt: Date; shippedAt: Date; trackingNumber: TrackingNumber }>
  | Readonly<{
      status: "cancelled";
      cancelledAt: Date;
      cancelledBy: CancelledBy;
      reason: CancelReason;
      /** 在庫を確保したあとの取消かどうか */
      confirmedAt: Date | null;
    }>
  | Readonly<{ status: "rejected"; rejectedAt: Date; unavailableProductIds: readonly ProductId[] }>;

export type OrderStatus = OrderState["status"];
export type OrderAction = "confirm" | "reject" | "expire" | "cancel" | "ship";

/**
 * 状態遷移表。どの状態で何ができるかはここにだけ書く。各メソッドの可否も、API が返す「いまできる操作」もここから作る。
 *
 *   placed ──confirm──▶ confirmed ──ship──▶ shipped
 *     ├──reject──▶ rejected    │
 *     └──cancel / expire──▶ cancelled ◀──cancel
 */
export const ORDER_TRANSITIONS = {
  placed: ["confirm", "reject", "expire", "cancel"],
  confirmed: ["ship", "cancel"],
  shipped: [],
  cancelled: [],
  rejected: [],
} as const satisfies Record<OrderStatus, readonly OrderAction[]>;

/** 操作 A を受け付ける状態（遷移表から型を作るので、表を変えると各メソッドの型も変わる） */
type StateAllowing<A extends OrderAction> = Extract<
  OrderState,
  { status: { [S in OrderStatus]: A extends (typeof ORDER_TRANSITIONS)[S][number] ? S : never }[OrderStatus] }
>;

export type OrderTotalLimitExceeded = {
  readonly type: "OrderTotalLimitExceeded";
  readonly total: Money;
  readonly limit: Money;
};
export type InvalidOrderTransition = {
  readonly type: "InvalidOrderTransition";
  readonly orderId: OrderId;
  readonly action: OrderAction;
  readonly currentStatus: OrderStatus;
};
export type ConfirmationNotOverdue = {
  readonly type: "ConfirmationNotOverdue";
  readonly orderId: OrderId;
  readonly deadline: Date;
};

const EXPIRED_REASON = unwrap(CancelReason.of("在庫の確保が期限内に終わらなかったため、自動で取り消しました"));

type Changed<E> = { order: Order; event: E };

/**
 * 注文（集約ルート）。明細は集約の内側にあり、外からは Order を通してしか変えられない。
 * 状態を変える操作は「新しい Order」と「起きた事実（イベント）」を返し、自分自身は書き換えない。
 */
export class Order {
  private constructor(
    readonly id: OrderId,
    readonly customerId: CustomerId,
    readonly lines: readonly OrderLine[],
    readonly state: OrderState,
    readonly placedAt: Date,
    /** 楽観ロック用。まだ保存していない集約は 0 */
    readonly version: number,
  ) {}

  static place(input: {
    id: OrderId;
    customerId: CustomerId;
    lines: readonly OrderLine[];
    now: Date;
  }): Result<Changed<OrderPlaced>, EmptyOrder | TooManyOrderLines | DuplicateOrderLine | OrderTotalLimitExceeded> {
    const checked = checkLines(input.lines.map((line) => line.productId));
    if (!checked.ok) return checked;
    const order = new Order(input.id, input.customerId, input.lines, { status: "placed" }, input.now, 0);
    if (order.total > ORDER_TOTAL_LIMIT) {
      return err({ type: "OrderTotalLimitExceeded", total: order.total, limit: ORDER_TOTAL_LIMIT });
    }
    const event: OrderPlaced = {
      type: "ordering.OrderPlaced",
      aggregateId: order.id,
      occurredAt: input.now,
      payload: { customerId: order.customerId, lines: order.snapshotLines(), total: order.total },
    };
    return ok({ order, event });
  }

  /** 保存済みの状態から復元する。リポジトリ専用 */
  static reconstitute(state: {
    id: OrderId;
    customerId: CustomerId;
    lines: readonly OrderLine[];
    state: OrderState;
    placedAt: Date;
    version: number;
  }): Order {
    return new Order(state.id, state.customerId, state.lines, state.state, state.placedAt, state.version);
  }

  get total(): Money {
    return this.lines.reduce((sum, line) => Money.add(sum, Money.times(line.unitPrice, line.quantity)), Money.zero);
  }

  /** いまの状態でできる操作 */
  get availableActions(): readonly OrderAction[] {
    return ORDER_TRANSITIONS[this.state.status];
  }

  /** 在庫の確保を待つ期限 */
  get confirmationDeadline(): Date {
    return new Date(this.placedAt.getTime() + CONFIRMATION_DEADLINE_MS);
  }

  /** 在庫を確保できたので確定する（在庫コンテキストからの知らせで呼ばれる） */
  confirm(now: Date): Result<Changed<OrderConfirmed>, InvalidOrderTransition> {
    const from = this.require("confirm");
    if (!from.ok) return from;
    const event: OrderConfirmed = {
      type: "ordering.OrderConfirmed",
      aggregateId: this.id,
      occurredAt: now,
      payload: {},
    };
    return ok({ order: this.evolve({ status: "confirmed", confirmedAt: now }), event });
  }

  /** 在庫が足りなかったので断る（在庫コンテキストからの知らせで呼ばれる） */
  reject(
    unavailableProductIds: readonly ProductId[],
    now: Date,
  ): Result<Changed<OrderRejected>, InvalidOrderTransition> {
    const from = this.require("reject");
    if (!from.ok) return from;
    const event: OrderRejected = {
      type: "ordering.OrderRejected",
      aggregateId: this.id,
      occurredAt: now,
      payload: { unavailableProductIds },
    };
    return ok({ order: this.evolve({ status: "rejected", rejectedAt: now, unavailableProductIds }), event });
  }

  /** お客様による取消。出荷する前ならできる */
  cancel(reason: CancelReason, now: Date): Result<Changed<OrderCancelled>, InvalidOrderTransition> {
    const from = this.require("cancel");
    if (!from.ok) return from;
    return ok(this.cancelled(from.value, "customer", reason, now));
  }

  /** 確保待ちのまま期限を過ぎた注文を、システムが取り消す。期限ちょうどから取り消せる */
  expire(now: Date): Result<Changed<OrderCancelled>, InvalidOrderTransition | ConfirmationNotOverdue> {
    const from = this.require("expire");
    if (!from.ok) return from;
    const deadline = this.confirmationDeadline;
    if (now < deadline) return err({ type: "ConfirmationNotOverdue", orderId: this.id, deadline });
    return ok(this.cancelled(from.value, "system", EXPIRED_REASON, now));
  }

  ship(trackingNumber: TrackingNumber, now: Date): Result<Changed<OrderShipped>, InvalidOrderTransition> {
    const from = this.require("ship");
    if (!from.ok) return from;
    const event: OrderShipped = {
      type: "ordering.OrderShipped",
      aggregateId: this.id,
      occurredAt: now,
      payload: { trackingNumber, lines: this.snapshotLines() },
    };
    const state = { status: "shipped", confirmedAt: from.value.confirmedAt, shippedAt: now, trackingNumber } as const;
    return ok({ order: this.evolve(state), event });
  }

  private cancelled(
    from: StateAllowing<"cancel" | "expire">,
    cancelledBy: CancelledBy,
    reason: CancelReason,
    now: Date,
  ): Changed<OrderCancelled> {
    const confirmedAt = from.status === "confirmed" ? from.confirmedAt : null;
    const event: OrderCancelled = {
      type: "ordering.OrderCancelled",
      aggregateId: this.id,
      occurredAt: now,
      payload: { reason, cancelledBy },
    };
    return { order: this.evolve({ status: "cancelled", cancelledAt: now, cancelledBy, reason, confirmedAt }), event };
  }

  /** 遷移表を引き、操作できるなら「いまの状態」を操作に合わせた型で返す */
  private require<A extends OrderAction>(action: A): Result<StateAllowing<A>, InvalidOrderTransition> {
    const allowed: readonly OrderAction[] = ORDER_TRANSITIONS[this.state.status];
    if (!allowed.includes(action)) {
      return err({ type: "InvalidOrderTransition", orderId: this.id, action, currentStatus: this.state.status });
    }
    return ok(this.state as StateAllowing<A>);
  }

  private evolve(state: OrderState): Order {
    return new Order(this.id, this.customerId, this.lines, state, this.placedAt, this.version);
  }

  private snapshotLines(): OrderLineSnapshot[] {
    return this.lines.map(({ productId, quantity, unitPrice }) => ({ productId, quantity, unitPrice }));
  }
}
