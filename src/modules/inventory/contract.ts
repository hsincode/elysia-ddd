/**
 * 在庫コンテキストの公開窓口。他のモジュールが import してよいのはこのファイルだけ。
 * 公開するのはイベントの型（Published Language）だけ。
 */
export type { InventoryEvent, Shortage, StockReservationFailed, StockReserved } from "./domain/inventory-events";
