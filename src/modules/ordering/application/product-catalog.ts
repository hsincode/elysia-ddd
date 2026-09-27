import type { Money } from "#shared/domain/money";
import type { ProductId } from "../domain/order";

/** 注文の言葉で表した「注文できる商品」 */
export type OrderableProduct = Readonly<{ id: ProductId; name: string; unitPrice: Money }>;

/**
 * 注文コンテキストが商品について知りたいことだけを定義したポート。
 * 実装（infrastructure/catalog-gateway.ts）がカタログの公開 API を呼んで翻訳する（腐敗防止層）。
 */
export interface ProductCatalog {
  /** 指定した商品のうち、いま注文できるものだけを返す */
  findOrderable(ids: readonly ProductId[]): Promise<ReadonlyMap<ProductId, OrderableProduct>>;
}
