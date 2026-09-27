import type { Order, OrderId } from "./order";

/** 集約単位の永続化。更新系のユースケースだけが使う */
export interface OrderRepository {
  findById(id: OrderId): Promise<Order | null>;
  /** cutoff までに（cutoff ちょうどを含む）注文され、まだ確保待ち（placed）の注文。期限切れの処理が使う */
  findUnconfirmedPlacedBy(cutoff: Date, limit: number): Promise<OrderId[]>;
  /**
   * 新規なら明細ごと追加し、既存なら version を照合して状態を更新する。衝突したら ConcurrencyError を投げる。
   * 複数の文を書くので UnitOfWork の中で呼ぶこと。
   */
  save(order: Order): Promise<void>;
}
