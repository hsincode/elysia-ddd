import { mkdir } from "node:fs/promises";
import { drizzle as drizzleBunSql } from "drizzle-orm/bun-sql";
import { migrate as migrateBunSql } from "drizzle-orm/bun-sql/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";

/** ドライバーに依存しない Drizzle の型。本番は Bun.SQL（PostgreSQL）、開発とテストは PGlite（WASM 版 PostgreSQL） */
export type Database = PgDatabase<PgQueryResultHKT>;

export type DatabaseConnection = {
  readonly db: Database;
  migrate(): Promise<void>;
  close(): Promise<void>;
};

/** drizzle-kit generate の出力先。カレントディレクトリ基準なので、単体バイナリで配るときも隣に置く */
const migrationsFolder = "drizzle";

export async function connectDatabase(options: { url?: string; pgliteDataDir: string }): Promise<DatabaseConnection> {
  if (options.url) {
    const client = new Bun.SQL(options.url);
    const db = drizzleBunSql({ client, casing: "snake_case" });
    return { db, migrate: () => migrateBunSql(db, { migrationsFolder }), close: () => client.close() };
  }
  // 本番では読み込まないよう動的 import にする
  const { PGlite } = await import("@electric-sql/pglite");
  if (!options.pgliteDataDir.startsWith("memory://")) await mkdir(options.pgliteDataDir, { recursive: true });
  const client = await PGlite.create(options.pgliteDataDir);
  const db = drizzlePglite({ client, casing: "snake_case" });
  return { db, migrate: () => migratePglite(db, { migrationsFolder }), close: () => client.close() };
}
