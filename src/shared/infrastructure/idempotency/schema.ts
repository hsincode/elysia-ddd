import { index, integer, jsonb, pgSchema, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/** HTTP API の基盤。どのコンテキストにも属さない */
export const api = pgSchema("api");

/** 冪等キーと、そのとき返した応答 */
export const idempotencyKeys = api.table(
  "idempotency_keys",
  {
    scope: text().notNull(),
    key: text().notNull(),
    fingerprint: text().notNull(),
    // 行は処理の前に作り、同じトランザクションの最後で応答を書き込む（コミット後は必ず埋まっている）
    responseStatus: integer(),
    responseBody: jsonb(),
    responseHeaders: jsonb().$type<Record<string, string>>(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] }), index("idempotency_keys_created_at_idx").on(t.createdAt)],
);
