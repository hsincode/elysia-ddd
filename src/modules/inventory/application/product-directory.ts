import type { ProductId } from "../domain/stock-item";

/** 在庫コンテキストが商品について知りたいこと（存在するか）だけを定義したポート。実装はカタログを呼ぶ ACL */
export interface ProductDirectory {
  exists(id: ProductId): Promise<boolean>;
}

export type ProductNotFound = { readonly type: "ProductNotFound"; readonly productId: string };
