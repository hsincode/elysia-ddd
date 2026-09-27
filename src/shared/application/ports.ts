import type { Result } from "#shared/domain/result";

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  /** 時刻順に並ぶ一意な ID（UUIDv7） */
  next(): string;
}

/**
 * トランザクション境界。アプリケーション層が知るのはこれだけで、トランザクションオブジェクトは受け渡さない
 * （リポジトリは実行中のトランザクションを暗黙に拾う）。
 */
export interface UnitOfWork {
  /** work を 1 つのトランザクションで実行する。Err を返すか例外を投げるとロールバックする。入れ子はセーブポイントになる */
  run<R extends Result<unknown, unknown>>(work: () => Promise<R>): Promise<R>;
}

/** 一定間隔で動かす処理（イベント配送・期限切れの処理・掃除）。同じ Job は重ねて動かさない */
export type Job = Readonly<{ name: string; intervalMs: number; run: () => Promise<void> }>;

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}
