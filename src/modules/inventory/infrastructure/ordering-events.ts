import type { OrderCancelled, OrderPlaced, OrderShipped } from "#modules/ordering/contract";
import { subscribe } from "#shared/application/events";
import type { FulfillStock, ReleaseStock, ReserveStock } from "../application/reservations";

/**
 * 注文コンテキストのイベントを在庫のユースケースにつなぐ受け口（イベントを受ける側の腐敗防止層）。
 * 注文の言葉（注文・取消・出荷）を在庫の言葉（引当・戻し・出庫）に訳すのはここだけ。
 */
export const orderingEventSubscriptions = (useCases: {
  reserveStock: ReserveStock;
  releaseStock: ReleaseStock;
  fulfillStock: FulfillStock;
}) => [
  subscribe<OrderPlaced>("inventory.reserve-stock", "ordering.OrderPlaced", async (event) => {
    await useCases.reserveStock({ orderId: event.aggregateId, lines: event.payload.lines });
  }),
  subscribe<OrderCancelled>("inventory.release-stock", "ordering.OrderCancelled", async (event) => {
    await useCases.releaseStock({ orderId: event.aggregateId });
  }),
  subscribe<OrderShipped>("inventory.fulfill-stock", "ordering.OrderShipped", async (event) => {
    await useCases.fulfillStock({ orderId: event.aggregateId });
  }),
];
