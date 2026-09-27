import type { Clock, IdGenerator, UnitOfWork } from "#shared/application/ports";
import { type InvalidMoney, Money } from "#shared/domain/money";
import { ok, type Result } from "#shared/domain/result";
import { type InvalidProductName, Product, ProductId, ProductName } from "../domain/product";
import type { ProductRepository } from "../domain/product-repository";

export type RegisterProductInput = Readonly<{ name: string; price: number }>;
export type RegisterProductError = InvalidProductName | InvalidMoney;
export type RegisterProduct = ReturnType<typeof registerProduct>;

export const registerProduct =
  (deps: { products: ProductRepository; unitOfWork: UnitOfWork; clock: Clock; ids: IdGenerator }) =>
  async (input: RegisterProductInput): Promise<Result<{ productId: ProductId }, RegisterProductError>> => {
    // 入力を Value Object にする（検証はここで終わり、以降は検証済みの型だけが流れる）
    const name = ProductName.of(input.name);
    if (!name.ok) return name;
    const price = Money.of(input.price);
    if (!price.ok) return price;

    const product = Product.register({
      id: ProductId(deps.ids.next()),
      name: name.value,
      price: price.value,
      now: deps.clock.now(),
    });
    return deps.unitOfWork.run(async () => {
      await deps.products.save(product);
      return ok({ productId: product.id });
    });
  };
