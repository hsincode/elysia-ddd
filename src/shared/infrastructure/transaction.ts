import { AsyncLocalStorage } from "node:async_hooks";
import { ConcurrencyError } from "#shared/application/errors";
import type { UnitOfWork } from "#shared/application/ports";
import type { Err, Result } from "#shared/domain/result";
import type { Database } from "./database";

/** 実行中のトランザクションがあればそれを、なければ接続プールを返す。リポジトリはこれ経由でだけ DB に触る */
export type CurrentDb = () => Database;

/** fn を 1 つのトランザクションで実行する。すでにトランザクション中ならセーブポイントを切る */
export type Transaction = <T>(fn: () => Promise<T>) => Promise<T>;

/** Err を返したときにロールバックさせるための内部用の例外 */
class Rollback extends Error {
  constructor(readonly result: Err<unknown>) {
    super("rollback");
  }
}

/** serialization_failure と deadlock_detected。やり直せば通るので ConcurrencyError に読み替える */
const RETRYABLE_SQLSTATES = new Set(["40001", "40P01"]);

const isRetryable = (error: unknown): boolean => {
  // Drizzle は元のエラーを cause に包む。SQLSTATE は Bun.SQL なら errno、PGlite なら code に入る
  for (let current = error; current instanceof Error; current = current.cause) {
    const { errno, code } = current as { errno?: unknown; code?: unknown };
    if (RETRYABLE_SQLSTATES.has(String(errno ?? code))) return true;
  }
  return false;
};

/**
 * トランザクションを AsyncLocalStorage で非同期の流れに乗せる（アンビエントトランザクション）。
 * ユースケースは tx を引数で回さずに済み、リポジトリは CurrentDb から今のトランザクションを拾う。
 */
export const createTransactionScope = (root: Database) => {
  const storage = new AsyncLocalStorage<Database>();
  const db: CurrentDb = () => storage.getStore() ?? root;

  const transaction: Transaction = async (fn) => {
    try {
      return await db().transaction((tx) => storage.run(tx, fn));
    } catch (error) {
      if (!(error instanceof ConcurrencyError) && isRetryable(error)) {
        throw new ConcurrencyError("transaction aborted by the database (serialization failure or deadlock)", {
          cause: error,
        });
      }
      throw error;
    }
  };

  const unitOfWork: UnitOfWork = {
    async run<R extends Result<unknown, unknown>>(work: () => Promise<R>): Promise<R> {
      try {
        return await transaction(async () => {
          const result = await work();
          if (!result.ok) throw new Rollback(result);
          return result;
        });
      } catch (error) {
        if (error instanceof Rollback) return error.result as R;
        throw error;
      }
    },
  };

  return { db, transaction, unitOfWork };
};
