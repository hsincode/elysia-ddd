import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { subscribe } from "#shared/application/events";
import type { DomainEvent } from "#shared/domain/domain-event";
import { err, ok } from "#shared/domain/result";
import { connectDatabase } from "#shared/infrastructure/database";
import { outboxPublisher } from "#shared/infrastructure/outbox/publisher";
import { createOutboxRelay } from "#shared/infrastructure/outbox/relay";
import { outbox } from "#shared/infrastructure/outbox/schema";
import { createTransactionScope } from "#shared/infrastructure/transaction";
import { fixedClock, sequentialIds, silentLogger } from "#test/support/fakes";

const database = await connectDatabase({ url: Bun.env.TEST_DATABASE_URL, pgliteDataDir: "memory://" });
await database.migrate();
await database.db.execute(
  sql`create table if not exists relay_test_handled (subscriber text, aggregate_id text, seq integer, primary key (subscriber, aggregate_id, seq))`,
);
afterAll(async () => {
  await database.db.execute(sql`drop table relay_test_handled`);
  await database.close();
});
// 主キーがあるので、同じ購読に同じイベントが二度届くと挿入が失敗する（＝二重配送の検出）
const handled = pgTable(
  "relay_test_handled",
  { subscriber: text().notNull(), aggregateId: text().notNull(), seq: integer().notNull() },
  (t) => [primaryKey({ columns: [t.subscriber, t.aggregateId, t.seq] })],
);

const clock = fixedClock();
const { db, transaction, unitOfWork } = createTransactionScope(database.db);
const publisher = outboxPublisher(db, sequentialIds());

/** 購読 a と b。failures に残りがあると、書き込んだあとで失敗する */
const failures = { a: 0, b: 0 };
const handler = (subscriber: "a" | "b") => async (event: DomainEvent) => {
  const { seq } = event.payload as { seq: number };
  await db().insert(handled).values({ subscriber, aggregateId: event.aggregateId, seq });
  if (failures[subscriber]-- > 0) throw new Error(`${subscriber} failed`);
};
const relay = createOutboxRelay({
  db,
  transaction,
  clock,
  logger: silentLogger,
  maxAttempts: 3,
  subscriptions: [
    subscribe("test.a", "test.Happened", handler("a")),
    subscribe("test.b", "test.Happened", handler("b")),
  ],
});

const emit = (aggregateId: string, seq = 1, outcome: "commit" | "rollback" = "commit") =>
  unitOfWork.run(async () => {
    await publisher.publish([{ type: "test.Happened", aggregateId, occurredAt: clock.now(), payload: { seq } }]);
    return outcome === "commit" ? ok() : err("rolled back");
  });

const handledBy = async (subscriber: "a" | "b") =>
  (await database.db.select().from(handled).where(eq(handled.subscriber, subscriber))).map(
    (row) => `${row.aggregateId}${row.seq}`,
  );
const pending = () => database.db.select().from(outbox).orderBy(outbox.id);

beforeEach(async () => {
  await database.db.delete(outbox);
  await database.db.delete(handled);
  failures.a = 0;
  failures.b = 0;
});

describe("OutboxRelay", () => {
  test("コミットされたイベントを、購読ごとに 1 回だけ配送する", async () => {
    await emit("x");
    expect(await relay.drain()).toBe(1);
    expect(await relay.drain()).toBe(0);
    expect(await handledBy("a")).toEqual(["x1"]);
    expect(await handledBy("b")).toEqual(["x1"]);
  });

  test("ロールバックした操作のイベントは配送されない", async () => {
    await emit("x", 1, "rollback");
    expect(await relay.drain()).toBe(0);
  });

  test("購読の 1 つが失敗したら、その購読の書き込みだけを戻し、成功した購読には二度届けない", async () => {
    failures.b = 1;
    await emit("x");
    expect(await relay.drain()).toBe(1);
    expect(await handledBy("a")).toEqual(["x1"]);
    expect(await handledBy("b")).toEqual([]);
    expect((await pending())[0]).toMatchObject({
      attempts: 1,
      publishedAt: null,
      lastError: "test.b: Error: b failed",
    });

    // バックオフ（2 秒）が明けるまでは配送しない
    expect(await relay.drain()).toBe(0);
    clock.advance(2_000);
    expect(await relay.drain()).toBe(1);
    expect(await handledBy("a")).toEqual(["x1"]);
    expect(await handledBy("b")).toEqual(["x1"]);
  });

  test("同じ集約のイベントは積まれた順に届け、ほかの集約は待たせない", async () => {
    failures.a = 1;
    await emit("x", 1);
    await emit("x", 2);
    await emit("y", 1);
    // x1 は失敗して後回し。x2 は x1 を追い越さずに待ち、y1 は先に届く
    expect(await relay.drain()).toBe(2);
    expect(await handledBy("b")).toEqual(["x1", "y1"]);

    clock.advance(2_000);
    expect(await relay.drain()).toBe(2);
    expect(await handledBy("a")).toEqual(["y1", "x1", "x2"]);
  });

  test("規定回数失敗したらデッドレターにし、同じ集約の後続を止めない", async () => {
    failures.a = 3;
    await emit("x", 1);
    await emit("x", 2);
    expect(await relay.drain()).toBe(1);
    clock.advance(2_000);
    expect(await relay.drain()).toBe(1);
    clock.advance(4_000);
    // 3 回目の失敗で x1 はデッドレターになり、止まっていた x2 がそのまま配送される
    expect(await relay.drain()).toBe(2);
    const [x1, x2] = await pending();
    expect(x1).toMatchObject({ attempts: 3, publishedAt: null });
    expect(x1?.deadAt).toBeInstanceOf(Date);
    expect(x2?.publishedAt).toBeInstanceOf(Date);
  });

  test("配送済みの古いイベントだけを消す", async () => {
    await emit("x");
    await relay.drain();
    await emit("y");
    clock.advance(1_000);
    expect(await relay.purgePublishedBefore(clock.now())).toBe(1);
    expect((await pending()).map((row) => row.aggregateId)).toEqual(["y"]);
  });
});
