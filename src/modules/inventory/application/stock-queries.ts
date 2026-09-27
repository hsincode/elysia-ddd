import { err, ok, type Result } from "#shared/domain/result";
import { ProductId } from "../domain/stock-item";
import type { ProductDirectory, ProductNotFound } from "./product-directory";

export type StockView = Readonly<{ productId: string; onHand: number; reserved: number; available: number }>;

/** 参照系の出口（CQRS の Q 側） */
export interface StockQueries {
  /** 一度も入荷していない商品は null */
  find(productId: string): Promise<StockView | null>;
}

export type GetStock = ReturnType<typeof getStock>;

/** 在庫を見る。カタログにある商品なら、まだ入荷していなくても 0 として返す */
export const getStock =
  (deps: { queries: StockQueries; products: ProductDirectory }) =>
  async (productId: string): Promise<Result<StockView, ProductNotFound>> => {
    const stock = await deps.queries.find(productId);
    if (stock) return ok(stock);
    if (!(await deps.products.exists(ProductId(productId)))) return err({ type: "ProductNotFound", productId });
    return ok({ productId, onHand: 0, reserved: 0, available: 0 });
  };
