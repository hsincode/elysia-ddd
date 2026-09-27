import { and, asc, eq, inArray } from "drizzle-orm";
import { ConcurrencyError } from "#shared/application/errors";
import type { CurrentDb } from "#shared/infrastructure/transaction";
import type { StockItemRepository } from "../domain/repositories";
import { ProductId, StockItem } from "../domain/stock-item";
import { stockItems } from "./schema";

export const drizzleStockItemRepository = (db: CurrentDb): StockItemRepository => ({
  async lockMany(ids) {
    if (ids.length === 0) return new Map();
    // ORDER BY のあとで行ロックを取るので、ロックは商品 ID の順になる
    const rows = await db()
      .select()
      .from(stockItems)
      .where(inArray(stockItems.productId, [...new Set(ids)]))
      .orderBy(asc(stockItems.productId))
      .for("update");
    return new Map(
      rows.map((row) => [
        ProductId(row.productId),
        StockItem.reconstitute({ ...row, productId: ProductId(row.productId) }),
      ]),
    );
  },

  async save(items) {
    for (const item of items) {
      const quantities = { onHand: item.onHand, reserved: item.reserved };
      if (item.version === 0) {
        // まだ無い行はロックできないので、同時に作られていたら衝突として知らせる
        const inserted = await db()
          .insert(stockItems)
          .values({ productId: item.productId, ...quantities, version: 1 })
          .onConflictDoNothing()
          .returning({ productId: stockItems.productId });
        if (inserted.length === 0) throw new ConcurrencyError(`stock item ${item.productId} was created concurrently`);
        continue;
      }
      const updated = await db()
        .update(stockItems)
        .set({ ...quantities, version: item.version + 1 })
        .where(and(eq(stockItems.productId, item.productId), eq(stockItems.version, item.version)))
        .returning({ productId: stockItems.productId });
      if (updated.length === 0) throw new ConcurrencyError(`stock item ${item.productId} was modified concurrently`);
    }
  },
});
