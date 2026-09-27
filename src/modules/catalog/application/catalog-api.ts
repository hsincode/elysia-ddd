import type { CatalogApi } from "../contract";
import type { ProductQueries } from "./product-queries";

/** 他のコンテキスト向けの公開 API（Open Host Service）。内部の型ではなく contract の型で答える */
export const catalogApi = (queries: ProductQueries): CatalogApi => ({
  async findProducts(ids) {
    const products = await queries.findByIds(ids);
    return products.map((product) => ({
      id: product.id,
      name: product.name,
      price: product.price,
      onSale: product.status === "on_sale",
    }));
  },
});
