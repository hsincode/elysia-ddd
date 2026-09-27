import { sql } from "drizzle-orm";
import { check, integer, pgSchema, primaryKey, text, uuid } from "drizzle-orm/pg-core";

export const inventory = pgSchema("inventory");

/** 商品ごとの在庫。0 ≤ reserved ≤ on_hand は DB でも守る */
export const stockItems = inventory.table(
  "stock_items",
  {
    productId: uuid().primaryKey(),
    onHand: integer().notNull(),
    reserved: integer().notNull(),
    version: integer().notNull(),
  },
  () => [check("stock_items_reserved_within_on_hand", sql`reserved >= 0 and reserved <= on_hand`)],
);

/** 注文ごとの引当の記録 */
export const reservations = inventory.table("reservations", {
  orderId: uuid().primaryKey(),
  status: text({ enum: ["reserved", "rejected", "released", "fulfilled", "voided"] }).notNull(),
  version: integer().notNull(),
});

export const reservationLines = inventory.table(
  "reservation_lines",
  {
    orderId: uuid()
      .notNull()
      .references(() => reservations.orderId, { onDelete: "cascade" }),
    productId: uuid().notNull(),
    quantity: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orderId, t.productId] }),
    check("reservation_lines_quantity_positive", sql`quantity > 0`),
  ],
);
