import { sql } from "drizzle-orm";
import { check, index, integer, pgSchema, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const ordering = pgSchema("ordering");

/**
 * 注文。状態ごとに意味を持つ列は null を許し、どの状態でどの列が埋まっているべきかを CHECK 制約でも守る
 * （ドメインの型が守っている条件を、DB の直接操作やマッピングの誤りからも守る二重の柵）。
 */
export const orders = ordering.table(
  "orders",
  {
    id: uuid().primaryKey(),
    customerId: uuid().notNull(),
    status: text({ enum: ["placed", "confirmed", "shipped", "cancelled", "rejected"] }).notNull(),
    /** 集約から計算した合計を保存しておき、一覧や集計で使う */
    total: integer().notNull(),
    placedAt: timestamp({ withTimezone: true }).notNull(),
    confirmedAt: timestamp({ withTimezone: true }),
    shippedAt: timestamp({ withTimezone: true }),
    trackingNumber: text(),
    cancelledAt: timestamp({ withTimezone: true }),
    cancelledBy: text({ enum: ["customer", "system"] }),
    cancelReason: text(),
    rejectedAt: timestamp({ withTimezone: true }),
    unavailableProductIds: uuid().array(),
    version: integer().notNull(),
  },
  (t) => [
    index("orders_placed_awaiting_idx").on(t.placedAt).where(sql`status = 'placed'`),
    check("orders_confirmed_has_time", sql`status not in ('confirmed', 'shipped') or confirmed_at is not null`),
    check(
      "orders_shipped_has_tracking",
      sql`status <> 'shipped' or (shipped_at is not null and tracking_number is not null)`,
    ),
    check(
      "orders_cancelled_has_reason",
      sql`status <> 'cancelled' or (cancelled_at is not null and cancelled_by is not null and cancel_reason is not null)`,
    ),
    check(
      "orders_rejected_has_products",
      sql`status <> 'rejected' or (rejected_at is not null and unavailable_product_ids is not null)`,
    ),
  ],
);

/** 集約の内側のエンティティ。Order と一緒にしか読み書きしない */
export const orderLines = ordering.table(
  "order_lines",
  {
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    lineNo: integer().notNull(),
    productId: uuid().notNull(),
    productName: text().notNull(),
    unitPrice: integer().notNull(),
    quantity: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.orderId, t.lineNo] })],
);
