import { treaty } from "@elysiajs/eden";
import { bootstrap } from "../../src/bootstrap";
import { loadConfig } from "../../src/config";
import { fixedClock, silentLogger } from "./fakes";

/**
 * 本番と同じ組み立てを、メモリ上の PGlite で起動する（TEST_DATABASE_URL があれば実際の PostgreSQL を使う）。
 * HTTP サーバーは立てず、Eden Treaty が app.handle() を直接呼ぶ。Job は自動では動かさず、テストが呼ぶ。
 */
export async function startTestSystem(env: Record<string, string> = {}) {
  const clock = fixedClock();
  const config = loadConfig({ DATABASE_URL: Bun.env.TEST_DATABASE_URL, PGLITE_DATA_DIR: "memory://", ...env });
  const system = await bootstrap(config, { clock, logger: silentLogger });
  await system.migrate();
  const runJob = async (name: string) => {
    const job = system.jobs.find((candidate) => candidate.name === name);
    if (!job) throw new Error(`no job named ${name}`);
    await job.run();
  };
  return { ...system, clock, runJob, api: treaty(system.app) };
}

/** Eden の結果から data を取り出す。失敗していたらその場でテストを落とす */
export function dataOf<T>(result: { data: T; error: null } | { data: null; error: unknown }): T {
  if (result.error !== null) throw new Error(`request failed: ${JSON.stringify(result.error)}`);
  return result.data as T;
}
