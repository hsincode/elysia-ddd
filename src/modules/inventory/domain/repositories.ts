import type { OrderId, Reservation } from "./reservation";
import type { ProductId, StockItem } from "./stock-item";

export interface StockItemRepository {
  /**
   * 指定した商品の在庫を行ロックして読む（悲観ロック）。人気商品に引当が集中しても、やり直しにならずに順番待ちになる。
   * ロックは商品 ID の順に取るので、2 つの注文が同じ商品の組を逆の順で引き当ててもデッドロックしない。
   * 一度も入荷していない商品は結果に含まれない。
   */
  lockMany(ids: readonly ProductId[]): Promise<Map<ProductId, StockItem>>;
  /** version 0 は追加（同時に追加されていたら ConcurrencyError）、それ以外は version を照合して更新する */
  save(items: readonly StockItem[]): Promise<void>;
}

export interface ReservationRepository {
  find(orderId: OrderId): Promise<Reservation | null>;
  /** version 0 は追加、それ以外は version を照合して更新する。衝突したら ConcurrencyError */
  save(reservation: Reservation): Promise<void>;
}
