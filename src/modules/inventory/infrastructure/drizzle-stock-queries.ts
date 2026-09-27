import { eq } from "drizzle-orm";
import type { CurrentDb } from "#shared/infrastructure/transaction";
import type { StockQueries } from "../application/stock-queries";
import { stockItems } from "./schema";

export const drizzleStockQueries = (db: CurrentDb): StockQueries => ({
  async find(productId) {
    const [row] = await db().select().from(stockItems).where(eq(stockItems.productId, productId));
    return row
      ? { productId: row.productId, onHand: row.onHand, reserved: row.reserved, available: row.onHand - row.reserved }
      : null;
  },
});
