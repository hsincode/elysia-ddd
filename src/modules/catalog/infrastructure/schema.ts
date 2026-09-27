import { integer, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** コンテキストごとに PostgreSQL のスキーマを分け、テーブルの持ち主をはっきりさせる */
export const catalog = pgSchema("catalog");

export const products = catalog.table("products", {
  id: uuid().primaryKey(),
  name: text().notNull(),
  price: integer().notNull(),
  status: text({ enum: ["on_sale", "discontinued"] }).notNull(),
  registeredAt: timestamp({ withTimezone: true }).notNull(),
  version: integer().notNull(),
});

/** 注文イベントから組み立てるリードモデル（販売数）。いつでも捨てて作り直せる */
export const productSales = catalog.table("product_sales", {
  productId: uuid().primaryKey(),
  unitsSold: integer().notNull(),
});
