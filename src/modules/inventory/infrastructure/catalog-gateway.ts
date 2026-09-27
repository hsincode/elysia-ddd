import type { CatalogApi } from "#modules/catalog/contract";
import type { ProductDirectory } from "../application/product-directory";

/** 腐敗防止層。カタログの公開 API から、在庫が知りたいこと（その商品があるか）だけを引き出す */
export const catalogGateway = (catalog: CatalogApi): ProductDirectory => ({
  async exists(id) {
    return (await catalog.findProducts([id])).length > 0;
  },
});
