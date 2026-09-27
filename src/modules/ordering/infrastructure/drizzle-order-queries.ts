import { eq } from "drizzle-orm";
import type { CurrentDb } from "#shared/infrastructure/transaction";
import type { OrderQueries, OrderView } from "../application/order-queries";
import { ORDER_TRANSITIONS } from "../domain/order";
import { orderLines, orders } from "./schema";

/** HTTP から操作できるもの（confirm などは在庫コンテキストやシステムが起こす） */
const PUBLIC_ACTIONS = new Set<string>(["cancel", "ship"]);

export const drizzleOrderQueries = (db: CurrentDb): OrderQueries => ({
  async findById(id) {
    const [order] = await db().select().from(orders).where(eq(orders.id, id));
    if (!order) return null;
    const lines = await db().select().from(orderLines).where(eq(orderLines.orderId, id)).orderBy(orderLines.lineNo);
    return {
      id: order.id,
      customerId: order.customerId,
      status: order.status,
      lines: lines.map((line) => ({
        productId: line.productId,
        productName: line.productName,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        subtotal: line.unitPrice * line.quantity,
      })),
      total: order.total,
      placedAt: order.placedAt,
      confirmedAt: order.confirmedAt,
      shipment:
        order.shippedAt && order.trackingNumber ? { at: order.shippedAt, trackingNumber: order.trackingNumber } : null,
      cancellation:
        order.cancelledAt && order.cancelledBy && order.cancelReason
          ? { at: order.cancelledAt, by: order.cancelledBy, reason: order.cancelReason }
          : null,
      rejection: order.rejectedAt
        ? { at: order.rejectedAt, unavailableProductIds: order.unavailableProductIds ?? [] }
        : null,
      actions: ORDER_TRANSITIONS[order.status].filter((action): action is OrderView["actions"][number] =>
        PUBLIC_ACTIONS.has(action),
      ),
    };
  },
});
