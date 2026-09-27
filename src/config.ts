import { type Static, Type as T } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const Env = T.Object({
  PORT: T.Integer({ default: 3000, minimum: 0, maximum: 65535 }),
  /** PostgreSQL の接続先。未設定なら PGlite（組み込みの PostgreSQL）で動く */
  DATABASE_URL: T.Optional(T.String({ pattern: "^postgres(ql)?://" })),
  /** PGlite のデータの置き場所。memory:// ならプロセスの終了で消える */
  PGLITE_DATA_DIR: T.String({ default: ".data/pglite" }),
  /** 起動時にマイグレーションを流す。複数台で動かすときは false にしてデプロイ手順で `bun run db:migrate` する */
  MIGRATE_ON_START: T.Boolean({ default: true }),
  OUTBOX_POLL_MS: T.Integer({ default: 500, minimum: 10 }),
  /** この回数配送に失敗したイベントはデッドレターにする */
  OUTBOX_MAX_ATTEMPTS: T.Integer({ default: 10, minimum: 1 }),
  /** リクエスト本文の上限（バイト）。超えたらパースする前に 413 */
  MAX_BODY_BYTES: T.Integer({ default: 1024 * 1024, minimum: 1024 }),
  LOG_LEVEL: T.Union([T.Literal("debug"), T.Literal("info"), T.Literal("warn"), T.Literal("error")], {
    default: "info",
  }),
});

export type Config = Static<typeof Env>;

/** 環境変数を型付きの設定にする。足りない値・壊れた値があれば起動時に落とす */
export function loadConfig(env: Record<string, string | undefined> = Bun.env): Config {
  const input = { ...env };
  try {
    return Value.Parse(Env, input);
  } catch {
    const converted = Value.Convert(Env, Value.Default(Env, Value.Clean(Env, input)));
    const problems = [...Value.Errors(Env, converted)].map((error) => `${error.path}: ${error.message}`);
    throw new Error(`invalid environment variables\n  ${problems.join("\n  ")}`);
  }
}
