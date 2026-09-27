import { and, asc, eq, lte } from "drizzle-orm";
import { ConcurrencyError } from "#shared/application/errors";
import { Money } from "#shared/domain/money";
import { unwrap } from "#shared/domain/result";
import type { CurrentDb } from "#shared/infrastructure/transaction";
import {
  CancelReason,
  CustomerId,
  Order,
  OrderId,
  type OrderState,
  ProductId,
  Quantity,
  TrackingNumber,
} from "../domain/order";
import type { OrderRepository } from "../domain/order-repository";
import { orderLines, orders } from "./schema";

type OrderRow = typeof orders.$inferSelect;

export const drizzleOrderRepository = (db: CurrentDb): OrderRepository => ({
  async findById(id) {
    const [row] = await db().select().from(orders).where(eq(orders.id, id));
    if (!row) return null;
    const lines = await db().select().from(orderLines).where(eq(orderLines.orderId, id)).orderBy(orderLines.lineNo);
    return toDomain(row, lines);
  },

  async findUnconfirmedPlacedBy(cutoff, limit) {
    const rows = await db()
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.status, "placed"), lte(orders.placedAt, cutoff)))
      .orderBy(asc(orders.placedAt))
      .limit(limit);
    return rows.map((row) => OrderId(row.id));
  },

  async save(order) {
    const state = toStateColumns(order.state);
    if (order.version === 0) {
      await db()
        .insert(orders)
        .values({
          id: order.id,
          customerId: order.customerId,
          total: order.total,
          placedAt: order.placedAt,
          ...state,
          version: 1,
        });
      await db()
        .insert(orderLines)
        .values(order.lines.map((line, index) => ({ orderId: order.id, lineNo: index + 1, ...line })));
      return;
    }
    // 明細は注文のあと変わらないので、更新するのは状態だけ
    const updated = await db()
      .update(orders)
      .set({ ...state, version: order.version + 1 })
      .where(and(eq(orders.id, order.id), eq(orders.version, order.version)))
      .returning({ id: orders.id });
    if (updated.length === 0) throw new ConcurrencyError(`order ${order.id} was modified concurrently`);
  },
});

/** 状態（判別共用体）を列に広げる。その状態で意味の無い列は必ず null にする */
const toStateColumns = (state: OrderState) => {
  const empty = {
    confirmedAt: null,
    shippedAt: null,
    trackingNumber: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    rejectedAt: null,
    unavailableProductIds: null,
  };
  switch (state.status) {
    case "placed":
      return { ...empty, status: state.status };
    case "confirmed":
      return { ...empty, status: state.status, confirmedAt: state.confirmedAt };
    case "shipped":
      return {
        ...empty,
        status: state.status,
        confirmedAt: state.confirmedAt,
        shippedAt: state.shippedAt,
        trackingNumber: state.trackingNumber,
      };
    case "cancelled":
      return {
        ...empty,
        status: state.status,
        confirmedAt: state.confirmedAt,
        cancelledAt: state.cancelledAt,
        cancelledBy: state.cancelledBy,
        cancelReason: state.reason,
      };
    case "rejected":
      return {
        ...empty,
        status: state.status,
        rejectedAt: state.rejectedAt,
        unavailableProductIds: [...state.unavailableProductIds],
      };
  }
};

/** 列から状態を組み立てる。CHECK 制約があるので欠けることは無いはずだが、欠けていたら黙って直さずに投げる */
const toState = (row: OrderRow): OrderState => {
  const missing = (column: string): never => {
    throw new Error(`order ${row.id} is ${row.status} but ${column} is null`);
  };
  switch (row.status) {
    case "placed":
      return { status: "placed" };
    case "confirmed":
      return { status: "confirmed", confirmedAt: row.confirmedAt ?? missing("confirmed_at") };
    case "shipped":
      return {
        status: "shipped",
        confirmedAt: row.confirmedAt ?? missing("confirmed_at"),
        shippedAt: row.shippedAt ?? missing("shipped_at"),
        trackingNumber: unwrap(TrackingNumber.of(row.trackingNumber ?? missing("tracking_number"))),
      };
    case "cancelled":
      return {
        status: "cancelled",
        cancelledAt: row.cancelledAt ?? missing("cancelled_at"),
        cancelledBy: row.cancelledBy ?? missing("cancelled_by"),
        reason: unwrap(CancelReason.of(row.cancelReason ?? missing("cancel_reason"))),
        confirmedAt: row.confirmedAt,
      };
    case "rejected":
      return {
        status: "rejected",
        rejectedAt: row.rejectedAt ?? missing("rejected_at"),
        unavailableProductIds: (row.unavailableProductIds ?? missing("unavailable_product_ids")).map(ProductId),
      };
  }
};

const toDomain = (row: OrderRow, lines: (typeof orderLines.$inferSelect)[]): Order =>
  Order.reconstitute({
    id: OrderId(row.id),
    customerId: CustomerId(row.customerId),
    lines: lines.map((line) => ({
      productId: ProductId(line.productId),
      productName: line.productName,
      unitPrice: unwrap(Money.of(line.unitPrice)),
      quantity: unwrap(Quantity.of(line.quantity)),
    })),
    state: toState(row),
    placedAt: row.placedAt,
    version: row.version,
  });
