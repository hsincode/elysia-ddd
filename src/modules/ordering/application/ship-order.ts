import { retryOnConflict } from "#shared/application/errors";
import type { EventPublisher } from "#shared/application/events";
import type { Clock, UnitOfWork } from "#shared/application/ports";
import { err, ok, type Result } from "#shared/domain/result";
import { type InvalidOrderTransition, type InvalidTrackingNumber, OrderId, TrackingNumber } from "../domain/order";
import type { OrderRepository } from "../domain/order-repository";
import type { OrderNotFound } from "./errors";

export type ShipOrderError = OrderNotFound | InvalidTrackingNumber | InvalidOrderTransition;
export type ShipOrder = ReturnType<typeof shipOrder>;

/** 出荷を記録する。確定（在庫確保済み）の注文だけが出荷できる */
export const shipOrder =
  (deps: { orders: OrderRepository; events: EventPublisher; unitOfWork: UnitOfWork; clock: Clock }) =>
  async (input: Readonly<{ orderId: string; trackingNumber: string }>): Promise<Result<void, ShipOrderError>> => {
    const trackingNumber = TrackingNumber.of(input.trackingNumber);
    if (!trackingNumber.ok) return trackingNumber;
    return retryOnConflict(() =>
      deps.unitOfWork.run(async () => {
        const order = await deps.orders.findById(OrderId(input.orderId));
        if (!order) return err({ type: "OrderNotFound", orderId: input.orderId });
        const shipped = order.ship(trackingNumber.value, deps.clock.now());
        if (!shipped.ok) return shipped;
        await deps.orders.save(shipped.value.order);
        await deps.events.publish([shipped.value.event]);
        return ok();
      }),
    );
  };
