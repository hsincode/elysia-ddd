import type { CatalogApi } from "#modules/catalog/contract";
import { Money } from "#shared/domain/money";
import { unwrap } from "#shared/domain/result";
import type { ProductCatalog } from "../application/product-catalog";
import { ProductId } from "../domain/order";

/**
 * 腐敗防止層（Anti-Corruption Layer）。カタログの公開 API を呼び、注文の言葉（注文できる商品・単価）に翻訳する。
 * カタログ側の都合が変わっても、注文コンテキストで直すのはこのファイルだけで済む。
 */
export const catalogGateway = (catalog: CatalogApi): ProductCatalog => ({
  async findOrderable(ids) {
    const products = await catalog.findProducts(ids);
    return new Map(
      products
        .filter((product) => product.onSale)
        .map((product) => {
          const id = ProductId(product.id);
          return [id, { id, name: product.name, unitPrice: unwrap(Money.of(product.price)) }] as const;
        }),
    );
  },
});
