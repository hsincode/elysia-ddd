import { sql } from "drizzle-orm";
import type { OrderShipped } from "#modules/ordering/contract";
import { subscribe } from "#shared/application/events";
import type { CurrentDb } from "#shared/infrastructure/transaction";
import { productSales } from "./schema";

/**
 * 注文コンテキストの OrderShipped から販売数のリードモデルを作る（結果整合性）。
 * 数えるのは出荷した数量だけ。出荷後の注文は取り消せないので、足したものを引き戻す必要がない。
 * 配送と同じトランザクションで書くので、同じイベントを二重に数えることもない。
 */
export const salesProjection = (db: CurrentDb) => [
  subscribe<OrderShipped>("catalog.count-units-sold", "ordering.OrderShipped", async (event) => {
    await db()
      .insert(productSales)
      .values(event.payload.lines.map((line) => ({ productId: line.productId, unitsSold: line.quantity })))
      .onConflictDoUpdate({
        target: productSales.productId,
        set: { unitsSold: sql`${productSales.unitsSold} + excluded.units_sold` },
      });
  }),
];
