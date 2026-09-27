import type { EventPublisher } from "#shared/application/events";
import type { IdGenerator } from "#shared/application/ports";
import type { CurrentDb } from "../transaction";
import { outbox } from "./schema";

/** EventPublisher の実装。今のトランザクションで outbox に積むだけで、配送は OutboxRelay に任せる */
export const outboxPublisher = (db: CurrentDb, ids: IdGenerator): EventPublisher => ({
  async publish(events) {
    if (events.length === 0) return;
    await db()
      .insert(outbox)
      .values(
        events.map((event) => ({
          id: ids.next(),
          type: event.type,
          aggregateId: event.aggregateId,
          payload: event.payload,
          occurredAt: event.occurredAt,
          nextAttemptAt: event.occurredAt,
        })),
      );
  },
});
