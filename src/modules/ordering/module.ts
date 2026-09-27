import type { CatalogApi } from "#modules/catalog/contract";
import type { EventPublisher } from "#shared/application/events";
import type { IdempotencyStore } from "#shared/application/idempotency";
import type { Clock, IdGenerator, Job, Logger, UnitOfWork } from "#shared/application/ports";
import type { CurrentDb } from "#shared/infrastructure/transaction";
import { cancelOrder } from "./application/cancel-order";
import { expireOverdueOrders } from "./application/expire-overdue-orders";
import { placeOrder } from "./application/place-order";
import { shipOrder } from "./application/ship-order";
import { confirmOrder, rejectOrder } from "./application/stock-outcomes";
import { catalogGateway } from "./infrastructure/catalog-gateway";
import { drizzleOrderQueries } from "./infrastructure/drizzle-order-queries";
import { drizzleOrderRepository } from "./infrastructure/drizzle-order-repository";
import { inventoryEventSubscriptions } from "./infrastructure/inventory-events";
import { orderingRoutes } from "./presentation/routes";

/** 注文コンテキストの組み立て（モジュール内のコンポジションルート）。呼ぶのは bootstrap.ts だけ */
export const createOrderingModule = (deps: {
  db: CurrentDb;
  unitOfWork: UnitOfWork;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
  events: EventPublisher;
  idempotency: IdempotencyStore;
  /** 上流コンテキスト（カタログ）の公開 API */
  catalog: CatalogApi;
}) => {
  const { db, unitOfWork, clock, ids, logger, events } = deps;
  const orders = drizzleOrderRepository(db);
  const expire = expireOverdueOrders({ orders, events, unitOfWork, clock, logger });
  return {
    routes: orderingRoutes({
      placeOrder: placeOrder({ orders, catalog: catalogGateway(deps.catalog), events, unitOfWork, clock, ids }),
      cancelOrder: cancelOrder({ orders, events, unitOfWork, clock }),
      shipOrder: shipOrder({ orders, events, unitOfWork, clock }),
      queries: drizzleOrderQueries(db),
      idempotency: deps.idempotency,
    }),
    subscriptions: inventoryEventSubscriptions({
      confirmOrder: confirmOrder({ orders, events, unitOfWork, clock }),
      rejectOrder: rejectOrder({ orders, events, unitOfWork, clock }),
    }),
    jobs: [
      {
        name: "ordering.expire-overdue-orders",
        intervalMs: 30_000,
        run: async () => {
          const expired = await expire();
          if (expired > 0) logger.info("expired overdue orders", { count: expired });
        },
      },
    ] satisfies Job[],
  };
};
