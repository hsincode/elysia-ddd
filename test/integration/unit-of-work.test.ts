import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import { ConcurrencyError } from "#shared/application/errors";
import { err, ok } from "#shared/domain/result";
import { connectDatabase } from "#shared/infrastructure/database";
import { createTransactionScope } from "#shared/infrastructure/transaction";

const database = await connectDatabase({ url: Bun.env.TEST_DATABASE_URL, pgliteDataDir: "memory://" });
// 接続プール（実 PostgreSQL）でも見えるよう、一時テーブルではなく普通のテーブルを作って最後に消す
await database.db.execute(sql`create table if not exists uow_test_notes (body text primary key)`);
afterAll(async () => {
  await database.db.execute(sql`drop table uow_test_notes`);
  await database.close();
});
const notes = pgTable("uow_test_notes", { body: text().primaryKey() });

const { db, transaction, unitOfWork } = createTransactionScope(database.db);
const write = (body: string) => db().insert(notes).values({ body });
const saved = async () => (await database.db.select().from(notes)).map((row) => row.body).sort();

describe("UnitOfWork", () => {
  test("Ok を返せばコミットする", async () => {
    const result = await unitOfWork.run(async () => {
      await write("commit");
      return ok("done");
    });
    expect(result).toEqual({ ok: true, value: "done" });
    expect(await saved()).toContain("commit");
  });

  test("Err を返せばロールバックし、Err をそのまま返す", async () => {
    const result = await unitOfWork.run(async () => {
      await write("rollback-on-err");
      return err({ type: "Rejected" });
    });
    expect(result).toEqual({ ok: false, error: { type: "Rejected" } });
    expect(await saved()).not.toContain("rollback-on-err");
  });

  test("例外ならロールバックして投げ直す", async () => {
    const run = unitOfWork.run(async () => {
      await write("rollback-on-throw");
      throw new Error("boom");
    });
    await expect(run).rejects.toThrow("boom");
    expect(await saved()).not.toContain("rollback-on-throw");
  });

  test("入れ子はセーブポイントになり、内側の Err は内側の書き込みだけを戻す", async () => {
    await unitOfWork.run(async () => {
      await write("outer");
      const inner = await unitOfWork.run(async () => {
        await write("inner");
        return err("inner failed");
      });
      expect(inner.ok).toBe(false);
      return ok();
    });
    const rows = await saved();
    expect(rows).toContain("outer");
    expect(rows).not.toContain("inner");
  });

  // PGlite は接続が 1 本で文が順に流れるので、デッドロックが起きない。実際の PostgreSQL でだけ確かめる
  test.skipIf(!Bun.env.TEST_DATABASE_URL)("DB が検出したデッドロックは ConcurrencyError に読み替える", async () => {
    await database.db.execute(
      sql`insert into uow_test_notes (body) values ('lock-a'), ('lock-b') on conflict do nothing`,
    );
    const lockBoth = (first: string, second: string) =>
      transaction(async () => {
        await db().execute(sql`select body from uow_test_notes where body = ${first} for update`);
        await Bun.sleep(200);
        await db().execute(sql`select body from uow_test_notes where body = ${second} for update`);
      });
    const results = await Promise.allSettled([lockBoth("lock-a", "lock-b"), lockBoth("lock-b", "lock-a")]);
    const failed = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
    expect(failed).toHaveLength(1);
    expect(failed[0]).toBeInstanceOf(ConcurrencyError);
  });
});
