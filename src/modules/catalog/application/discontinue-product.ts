import type { UnitOfWork } from "#shared/application/ports";
import { err, ok, type Result } from "#shared/domain/result";
import { type ProductAlreadyDiscontinued, ProductId } from "../domain/product";
import type { ProductRepository } from "../domain/product-repository";

export type ProductNotFound = { readonly type: "ProductNotFound"; readonly productId: string };
export type DiscontinueProductError = ProductNotFound | ProductAlreadyDiscontinued;
export type DiscontinueProduct = ReturnType<typeof discontinueProduct>;

export const discontinueProduct =
  (deps: { products: ProductRepository; unitOfWork: UnitOfWork }) =>
  (input: Readonly<{ productId: string }>): Promise<Result<void, DiscontinueProductError>> =>
    deps.unitOfWork.run(async () => {
      const product = await deps.products.findById(ProductId(input.productId));
      if (!product) return err({ type: "ProductNotFound", productId: input.productId });
      const discontinued = product.discontinue();
      if (!discontinued.ok) return discontinued;
      await deps.products.save(discontinued.value);
      return ok();
    });
