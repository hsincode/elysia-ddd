/**
 * 注文コンテキストの公開窓口。他のモジュールが import してよいのはこのファイルだけ。
 * 公開するのはイベントの型（Published Language）だけで、集約やリポジトリは見せない。
 */
export type {
  OrderCancelled,
  OrderConfirmed,
  OrderingEvent,
  OrderLineSnapshot,
  OrderPlaced,
  OrderRejected,
  OrderShipped,
} from "./domain/order-events";
