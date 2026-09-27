// デプロイ手順から流すマイグレーション（MIGRATE_ON_START=false で運用するとき用）
import { connectDatabase } from "#shared/infrastructure/database";
import { loadConfig } from "./config";

const config = loadConfig();
const database = await connectDatabase({ url: config.DATABASE_URL, pgliteDataDir: config.PGLITE_DATA_DIR });
await database.migrate();
await database.close();
console.log("migrations applied");
