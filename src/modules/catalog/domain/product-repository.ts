import type { Product, ProductId } from "./product";

/** 集約単位の永続化。更新系のユースケースだけが使う（一覧や詳細の表示はクエリサービスで読む） */
export interface ProductRepository {
  findById(id: ProductId): Promise<Product | null>;
  /** 新規なら追加し、既存なら version を照合して更新する。衝突したら ConcurrencyError を投げる */
  save(product: Product): Promise<void>;
}
