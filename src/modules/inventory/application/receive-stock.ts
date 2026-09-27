import { retryOnConflict } from "#shared/application/errors";
import type { UnitOfWork } from "#shared/application/ports";
import { err, ok, type Result } from "#shared/domain/result";
import type { StockItemRepository } from "../domain/repositories";
import { type InvalidQuantity, ProductId, Quantity, StockItem, type StockLimitExceeded } from "../domain/stock-item";
import type { ProductDirectory, ProductNotFound } from "./product-directory";

export type ReceiveStockError = InvalidQuantity | ProductNotFound | StockLimitExceeded;
export type ReceiveStock = ReturnType<typeof receiveStock>;

/** 入荷を記録する。カタログに無い商品には入荷できない */
export const receiveStock =
  (deps: { stock: StockItemRepository; products: ProductDirectory; unitOfWork: UnitOfWork }) =>
  async (input: Readonly<{ productId: string; quantity: number }>): Promise<Result<void, ReceiveStockError>> => {
    const quantity = Quantity.of(input.quantity);
    if (!quantity.ok) return quantity;
    const productId = ProductId(input.productId);
    if (!(await deps.products.exists(productId))) return err({ type: "ProductNotFound", productId: input.productId });

    // 初めての入荷が同時に 2 件来ると、片方の追加が衝突する（まだ無い行はロックできない）。読み直せば通る
    return retryOnConflict(() =>
      deps.unitOfWork.run(async () => {
        const item = (await deps.stock.lockMany([productId])).get(productId) ?? StockItem.empty(productId);
        const received = item.receive(quantity.value);
        if (!received.ok) return received;
        await deps.stock.save([received.value]);
        return ok();
      }),
    );
  };
