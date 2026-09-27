import { and, asc, eq, isNull, lt, lte, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Subscription } from "#shared/application/events";
import type { Clock, Logger } from "#shared/application/ports";
import type { CurrentDb, Transaction } from "../transaction";
import { deliveries, outbox } from "./schema";

export type OutboxRelay = {
  /** いま配送できるイベントをすべて処理し、処理した件数を返す。購読が新しく積んだイベントも続けて処理する */
  drain(): Promise<number>;
  /** 配送済みで cutoff より古いイベントを消す（outbox を太らせない） */
  purgePublishedBefore(cutoff: Date): Promise<number>;
};

const MAX_BACKOFF_MS = 60 * 60 * 1000;
const backoff = (attempts: number) => Math.min(1000 * 2 ** attempts, MAX_BACKOFF_MS);

/**
 * outbox のイベントを購読へ配送する。
 * - 同じ集約のイベントは積まれた順に届ける（古いものが配送待ちなら新しいものは待つ）
 * - 購読ごとにセーブポイントを切り、配送済みを deliveries に記録する。失敗した購読だけがあとでやり直しになる
 * - 購読の書き込みと配送済みの記録は同じトランザクションで確定するので、同じ DB に書くだけの購読は二重に適用されない
 * - maxAttempts 回失敗したらデッドレターにして、その集約の後続を止めないようにする
 */
export const createOutboxRelay = (deps: {
  db: CurrentDb;
  transaction: Transaction;
  clock: Clock;
  logger: Logger;
  subscriptions: readonly Subscription[];
  maxAttempts: number;
}): OutboxRelay => {
  const { db, transaction, clock, logger } = deps;
  const subscribersOf = Map.groupBy(deps.subscriptions, (subscription) => subscription.type);
  const earlier = alias(outbox, "earlier");

  const deliverNext = (): Promise<boolean> =>
    transaction(async () => {
      const now = clock.now();
      const [event] = await db()
        .select()
        .from(outbox)
        .where(
          and(
            isNull(outbox.publishedAt),
            isNull(outbox.deadAt),
            lte(outbox.nextAttemptAt, now),
            notExists(
              db()
                .select({ id: earlier.id })
                .from(earlier)
                .where(
                  and(
                    eq(earlier.aggregateId, outbox.aggregateId),
                    lt(earlier.id, outbox.id),
                    isNull(earlier.publishedAt),
                    isNull(earlier.deadAt),
                  ),
                ),
            ),
          ),
        )
        .orderBy(asc(outbox.nextAttemptAt), asc(outbox.id))
        .limit(1)
        // 複数のインスタンスが同じイベントを取り合わない
        .for("update", { skipLocked: true });
      if (!event) return false;

      const delivered = await db()
        .select({ subscriber: deliveries.subscriber })
        .from(deliveries)
        .where(eq(deliveries.eventId, event.id));
      const done = new Set(delivered.map((row) => row.subscriber));
      const failures: string[] = [];

      for (const subscription of subscribersOf.get(event.type) ?? []) {
        if (done.has(subscription.name)) continue;
        try {
          await transaction(async () => {
            await subscription.handle({
              type: event.type,
              aggregateId: event.aggregateId,
              occurredAt: event.occurredAt,
              payload: event.payload,
            });
            await db()
              .insert(deliveries)
              .values({ eventId: event.id, subscriber: subscription.name, deliveredAt: now });
          });
        } catch (error) {
          failures.push(`${subscription.name}: ${String(error)}`);
          logger.error("event handler failed", {
            eventId: event.id,
            type: event.type,
            subscriber: subscription.name,
            attempt: event.attempts + 1,
            error,
          });
        }
      }

      if (failures.length === 0) {
        await db().update(outbox).set({ publishedAt: now }).where(eq(outbox.id, event.id));
        return true;
      }
      const attempts = event.attempts + 1;
      const dead = attempts >= deps.maxAttempts;
      await db()
        .update(outbox)
        .set({
          attempts,
          lastError: failures.join("\n"),
          nextAttemptAt: new Date(now.getTime() + backoff(attempts)),
          deadAt: dead ? now : null,
        })
        .where(eq(outbox.id, event.id));
      if (dead) logger.error("event moved to dead letter", { eventId: event.id, type: event.type, attempts });
      return true;
    });

  return {
    async drain() {
      let processed = 0;
      while (await deliverNext()) processed++;
      return processed;
    },
    async purgePublishedBefore(cutoff) {
      const purged = await db().delete(outbox).where(lt(outbox.publishedAt, cutoff)).returning({ id: outbox.id });
      return purged.length;
    },
  };
};
