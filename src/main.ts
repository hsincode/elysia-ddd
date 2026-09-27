import { bootstrap } from "./bootstrap";
import { loadConfig } from "./config";

const config = loadConfig();
const system = await bootstrap(config);
if (config.MIGRATE_ON_START) await system.migrate();

system.app.listen(config.PORT);
system.scheduler.start();
system.logger.info("server started", {
  url: system.app.server?.url.href,
  database: config.DATABASE_URL ? "postgres" : `pglite (${config.PGLITE_DATA_DIR})`,
});

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  system.logger.info("shutting down", { signal });
  // 新しい接続を断り、処理中のリクエストが終わるのを待ってから、Job（配送など）と DB を止める
  await system.app.stop();
  await system.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
