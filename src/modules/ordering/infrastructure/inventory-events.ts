import type { StockReservationFailed, StockReserved } from "#modules/inventory/contract";
import { subscribe } from "#shared/application/events";
import type { ConfirmOrder, RejectOrder } from "../application/stock-outcomes";

/**
 * 在庫コンテキストのイベントを注文のユースケースにつなぐ受け口（イベントを受ける側の腐敗防止層）。
 * 在庫側の言葉（引当・不足）を注文側の言葉（確定・却下）に訳すのはここだけ。
 */
export const inventoryEventSubscriptions = (useCases: { confirmOrder: ConfirmOrder; rejectOrder: RejectOrder }) => [
  subscribe<StockReserved>("ordering.confirm-order", "inventory.StockReserved", async (event) => {
    await useCases.confirmOrder({ orderId: event.payload.orderId });
  }),
  subscribe<StockReservationFailed>("ordering.reject-order", "inventory.StockReservationFailed", async (event) => {
    await useCases.rejectOrder({
      orderId: event.payload.orderId,
      unavailableProductIds: event.payload.shortages.map((shortage) => shortage.productId),
    });
  }),
];
