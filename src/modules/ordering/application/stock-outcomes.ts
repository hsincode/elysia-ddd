import type { EventPublisher } from "#shared/application/events";
import type { Clock, UnitOfWork } from "#shared/application/ports";
import { ok, type Result } from "#shared/domain/result";
import { type Order, OrderId, ProductId } from "../domain/order";
import type { OrderRepository } from "../domain/order-repository";

type Deps = { orders: OrderRepository; events: EventPublisher; unitOfWork: UnitOfWork; clock: Clock };

/** 在庫確保の結果を受けたときの扱い。applied は状態を変えた、ignored は何もしなかった */
export type StockOutcome = "applied" | "ignored";

const load = async (orders: OrderRepository, orderId: string): Promise<Order> => {
  const order = await orders.findById(OrderId(orderId));
  // 注文のコミットより先に在庫の知らせが来ることはない。来たらデータの不整合なので、投げてリトライ・デッドレターに回す
  if (!order) throw new Error(`order ${orderId} not found while applying a stock outcome`);
  return order;
};

/**
 * 在庫を確保できた知らせで注文を確定する。
 * 取消や期限切れのあとに届いた知らせ、重複して届いた知らせは無視する（確保した在庫は取消のイベントで戻る）。
 */
export const confirmOrder =
  (deps: Deps) =>
  (input: Readonly<{ orderId: string }>): Promise<Result<StockOutcome, never>> =>
    deps.unitOfWork.run(async () => {
      const confirmed = (await load(deps.orders, input.orderId)).confirm(deps.clock.now());
      if (!confirmed.ok) return ok("ignored");
      await deps.orders.save(confirmed.value.order);
      await deps.events.publish([confirmed.value.event]);
      return ok("applied");
    });

/** 在庫が足りなかった知らせで注文を却下する。確保待ち以外の注文には何もしない */
export const rejectOrder =
  (deps: Deps) =>
  (
    input: Readonly<{ orderId: string; unavailableProductIds: readonly string[] }>,
  ): Promise<Result<StockOutcome, never>> =>
    deps.unitOfWork.run(async () => {
      const order = await load(deps.orders, input.orderId);
      const rejected = order.reject(input.unavailableProductIds.map(ProductId), deps.clock.now());
      if (!rejected.ok) return ok("ignored");
      await deps.orders.save(rejected.value.order);
      await deps.events.publish([rejected.value.event]);
      return ok("applied");
    });

export type ConfirmOrder = ReturnType<typeof confirmOrder>;
export type RejectOrder = ReturnType<typeof rejectOrder>;
