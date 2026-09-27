import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgSchema, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** モジュール間メッセージングの基盤。どのコンテキストにも属さない */
export const messaging = pgSchema("messaging");

/**
 * Transactional Outbox。集約の変更と同じトランザクションでイベントを書き、コミット後に OutboxRelay が配送する。
 * 「DB は更新されたのにイベントが消えた」「ロールバックしたのにイベントだけ飛んだ」を防ぐ。
 */
export const outbox = messaging.table(
  "outbox",
  {
    id: uuid().primaryKey(),
    type: text().notNull(),
    aggregateId: text().notNull(),
    payload: jsonb().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    publishedAt: timestamp({ withTimezone: true }),
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }).notNull(),
    lastError: text(),
    /** 規定回数失敗して配送をあきらめた時刻（デッドレター）。原因を直して null に戻せば配送を再開する */
    deadAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("outbox_pending_idx").on(t.nextAttemptAt, t.id).where(sql`published_at is null and dead_at is null`),
    index("outbox_pending_by_aggregate_idx")
      .on(t.aggregateId, t.id)
      .where(sql`published_at is null and dead_at is null`),
  ],
);

/**
 * 購読ごとの配送済みの記録（Inbox）。1 つのイベントに購読が複数あっても、
 * 失敗した購読だけをやり直し、成功済みの購読に二度届けない。
 */
export const deliveries = messaging.table(
  "deliveries",
  {
    eventId: uuid()
      .notNull()
      .references(() => outbox.id, { onDelete: "cascade" }),
    subscriber: text().notNull(),
    deliveredAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.subscriber] })],
);
