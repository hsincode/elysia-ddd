import { and, eq, lt } from "drizzle-orm";
import type { IdempotencyStore } from "#shared/application/idempotency";
import type { Clock } from "#shared/application/ports";
import type { CurrentDb, Transaction } from "../transaction";
import { idempotencyKeys } from "./schema";

export const idempotencyStore = (deps: {
  db: CurrentDb;
  transaction: Transaction;
  clock: Clock;
}): IdempotencyStore & { purgeOlderThan(cutoff: Date): Promise<number> } => {
  const { db, transaction } = deps;
  return {
    execute: ({ scope, key, fingerprint }, work) =>
      transaction(async () => {
        const row = and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key));
        // 先に行を作ってキーを押さえる。同じキーの同時リクエストは、ここで相手のコミットを待つ
        const claimed = await db()
          .insert(idempotencyKeys)
          .values({ scope, key, fingerprint, createdAt: deps.clock.now() })
          .onConflictDoNothing()
          .returning({ key: idempotencyKeys.key });

        if (claimed.length === 0) {
          const [existing] = await db().select().from(idempotencyKeys).where(row);
          if (!existing || existing.responseStatus === null) throw new Error(`idempotency key ${key} has no response`);
          if (existing.fingerprint !== fingerprint) return { kind: "mismatch" };
          return {
            kind: "replayed",
            response: {
              status: existing.responseStatus,
              body: existing.responseBody,
              headers: existing.responseHeaders ?? {},
            },
          };
        }

        const { result, response } = await work();
        await db()
          .update(idempotencyKeys)
          .set({ responseStatus: response.status, responseBody: response.body, responseHeaders: response.headers })
          .where(row);
        return { kind: "executed", result };
      }),

    async purgeOlderThan(cutoff) {
      const purged = await db()
        .delete(idempotencyKeys)
        .where(lt(idempotencyKeys.createdAt, cutoff))
        .returning({ key: idempotencyKeys.key });
      return purged.length;
    },
  };
};
