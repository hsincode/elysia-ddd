import { and, eq } from "drizzle-orm";
import { ConcurrencyError } from "#shared/application/errors";
import { Money } from "#shared/domain/money";
import { unwrap } from "#shared/domain/result";
import type { CurrentDb } from "#shared/infrastructure/transaction";
import { Product, ProductId, ProductName } from "../domain/product";
import type { ProductRepository } from "../domain/product-repository";
import { products } from "./schema";

export const drizzleProductRepository = (db: CurrentDb): ProductRepository => ({
  async findById(id) {
    const [row] = await db().select().from(products).where(eq(products.id, id));
    return row ? toDomain(row) : null;
  },

  async save(product) {
    const state = {
      name: product.name,
      price: product.price,
      status: product.status,
      registeredAt: product.registeredAt,
    };
    if (product.version === 0) {
      await db()
        .insert(products)
        .values({ id: product.id, ...state, version: 1 });
      return;
    }
    const updated = await db()
      .update(products)
      .set({ ...state, version: product.version + 1 })
      .where(and(eq(products.id, product.id), eq(products.version, product.version)))
      .returning({ id: products.id });
    if (updated.length === 0) throw new ConcurrencyError(`product ${product.id} was modified concurrently`);
  },
});

const toDomain = (row: typeof products.$inferSelect): Product =>
  Product.reconstitute({
    id: ProductId(row.id),
    name: unwrap(ProductName.of(row.name)),
    price: unwrap(Money.of(row.price)),
    status: row.status,
    registeredAt: row.registeredAt,
    version: row.version,
  });
