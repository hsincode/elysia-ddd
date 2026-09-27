import { desc, eq, inArray, sql } from "drizzle-orm";
import type { CurrentDb } from "#shared/infrastructure/transaction";
import type { ProductQueries } from "../application/product-queries";
import { productSales, products } from "./schema";

export const drizzleProductQueries = (db: CurrentDb): ProductQueries => {
  const unitsSold = sql<number>`coalesce(${productSales.unitsSold}, 0)`.mapWith(Number);
  const select = () =>
    db()
      .select({
        id: products.id,
        name: products.name,
        price: products.price,
        status: products.status,
        unitsSold,
        registeredAt: products.registeredAt,
      })
      .from(products)
      .leftJoin(productSales, eq(productSales.productId, products.id));

  return {
    async findById(id) {
      const [row] = await select().where(eq(products.id, id));
      return row ?? null;
    },
    async findByIds(ids) {
      return ids.length === 0 ? [] : select().where(inArray(products.id, [...ids]));
    },
    list({ sort, limit }) {
      const newest = [desc(products.registeredAt), desc(products.id)];
      return select()
        .orderBy(...(sort === "popular" ? [desc(unitsSold), ...newest] : newest))
        .limit(limit);
    },
  };
};
