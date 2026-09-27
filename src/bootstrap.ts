import { createCatalogModule } from "#modules/catalog/module";
import { createInventoryModule } from "#modules/inventory/module";
import { createOrderingModule } from "#modules/ordering/module";
import type { Clock, IdGenerator, Job, Logger } from "#shared/application/ports";
import { connectDatabase } from "#shared/infrastructure/database";
import { idempotencyStore } from "#shared/infrastructure/idempotency/store";
import { outboxPublisher } from "#shared/infrastructure/outbox/publisher";
import { createOutboxRelay } from "#shared/infrastructure/outbox/relay";
import { createScheduler } from "#shared/infrastructure/scheduler";
import { jsonLogger, systemClock, uuidV7 } from "#shared/infrastructure/system";
import { createTransactionScope } from "#shared/infrastructure/transaction";
import { httpApp } from "#shared/presentation/http-app";
import type { Config } from "./config";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * コンポジションルート。どの実装を使うかを決めて組み立てるのはここだけ。
 * テストも同じ組み立てを使い、時計やロガーだけを差し替える。
 */
export async function bootstrap(
  config: Config,
  overrides: Partial<{ clock: Clock; ids: IdGenerator; logger: Logger }> = {},
) {
  const clock = overrides.clock ?? systemClock;
  const ids = overrides.ids ?? uuidV7;
  const logger = overrides.logger ?? jsonLogger(config.LOG_LEVEL);

  const database = await connectDatabase({ url: config.DATABASE_URL, pgliteDataDir: config.PGLITE_DATA_DIR });
  const { db, transaction, unitOfWork } = createTransactionScope(database.db);
  const events = outboxPublisher(db, ids);
  const idempotency = idempotencyStore({ db, transaction, clock });

  // 上流（カタログ）から組み立て、公開 API を下流（在庫・注文）に渡す。在庫と注文はイベントだけでつながる
  const catalog = createCatalogModule({ db, unitOfWork, clock, ids });
  const inventory = createInventoryModule({ db, unitOfWork, clock, events, idempotency, catalog: catalog.api });
  const ordering = createOrderingModule({
    db,
    unitOfWork,
    clock,
    ids,
    logger,
    events,
    idempotency,
    catalog: catalog.api,
  });

  const relay = createOutboxRelay({
    db,
    transaction,
    clock,
    logger,
    subscriptions: [...catalog.subscriptions, ...inventory.subscriptions, ...ordering.subscriptions],
    maxAttempts: config.OUTBOX_MAX_ATTEMPTS,
  });

  const ago = (ms: number) => new Date(clock.now().getTime() - ms);
  const jobs: Job[] = [
    { name: "outbox.deliver", intervalMs: config.OUTBOX_POLL_MS, run: async () => void (await relay.drain()) },
    {
      name: "outbox.purge-published",
      intervalMs: HOUR_MS,
      run: async () => void (await relay.purgePublishedBefore(ago(7 * DAY_MS))),
    },
    {
      name: "api.purge-idempotency-keys",
      intervalMs: HOUR_MS,
      run: async () => void (await idempotency.purgeOlderThan(ago(DAY_MS))),
    },
    ...ordering.jobs,
  ];
  const scheduler = createScheduler(jobs, logger);

  const app = httpApp(logger, { maxBodyBytes: config.MAX_BODY_BYTES })
    .use(catalog.routes)
    .use(inventory.routes)
    .use(ordering.routes);

  return {
    app,
    relay,
    jobs,
    scheduler,
    logger,
    migrate: database.migrate,
    /** HTTP を止めたあとに呼ぶ。実行中の Job（配送など）が終わるのを待ってから DB を閉じる */
    async close() {
      await scheduler.stop();
      await database.close();
    },
  };
}

/** Eden Treaty 用の型。クライアントは `import type { App }` するだけで API の型が手に入る */
export type App = Awaited<ReturnType<typeof bootstrap>>["app"];
