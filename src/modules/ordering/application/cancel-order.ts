import { retryOnConflict } from "#shared/application/errors";
import type { EventPublisher } from "#shared/application/events";
import type { Clock, UnitOfWork } from "#shared/application/ports";
import { err, ok, type Result } from "#shared/domain/result";
import { CancelReason, type InvalidCancelReason, type InvalidOrderTransition, OrderId } from "../domain/order";
import type { OrderRepository } from "../domain/order-repository";
import type { OrderNotFound } from "./errors";

export type CancelOrderError = OrderNotFound | InvalidCancelReason | InvalidOrderTransition;
export type CancelOrder = ReturnType<typeof cancelOrder>;

/** お客様による取消。確保済みの在庫は、在庫コンテキストが OrderCancelled を受けて戻す */
export const cancelOrder =
  (deps: { orders: OrderRepository; events: EventPublisher; unitOfWork: UnitOfWork; clock: Clock }) =>
  async (input: Readonly<{ orderId: string; reason: string }>): Promise<Result<void, CancelOrderError>> => {
    const reason = CancelReason.of(input.reason);
    if (!reason.ok) return reason;
    // 在庫の確定と同時に取消が来たら楽観ロックが衝突する。読み直せば正しい状態で判断できる
    return retryOnConflict(() =>
      deps.unitOfWork.run(async () => {
        const order = await deps.orders.findById(OrderId(input.orderId));
        if (!order) return err({ type: "OrderNotFound", orderId: input.orderId });
        const cancelled = order.cancel(reason.value, deps.clock.now());
        if (!cancelled.ok) return cancelled;
        await deps.orders.save(cancelled.value.order);
        await deps.events.publish([cancelled.value.event]);
        return ok();
      }),
    );
  };
