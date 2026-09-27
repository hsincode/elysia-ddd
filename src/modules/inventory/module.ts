import type { CatalogApi } from "#modules/catalog/contract";
import type { EventPublisher } from "#shared/application/events";
import type { IdempotencyStore } from "#shared/application/idempotency";
import type { Clock, UnitOfWork } from "#shared/application/ports";
import type { CurrentDb } from "#shared/infrastructure/transaction";
import { receiveStock } from "./application/receive-stock";
import { fulfillStock, releaseStock, reserveStock } from "./application/reservations";
import { getStock } from "./application/stock-queries";
import { catalogGateway } from "./infrastructure/catalog-gateway";
import { drizzleReservationRepository } from "./infrastructure/drizzle-reservation-repository";
import { drizzleStockQueries } from "./infrastructure/drizzle-stock-queries";
import { drizzleStockItemRepository } from "./infrastructure/drizzle-stock-repository";
import { orderingEventSubscriptions } from "./infrastructure/ordering-events";
import { inventoryRoutes } from "./presentation/routes";

/** 在庫コンテキストの組み立て（モジュール内のコンポジションルート）。呼ぶのは bootstrap.ts だけ */
export const createInventoryModule = (deps: {
  db: CurrentDb;
  unitOfWork: UnitOfWork;
  clock: Clock;
  events: EventPublisher;
  idempotency: IdempotencyStore;
  /** 上流コンテキスト（カタログ）の公開 API */
  catalog: CatalogApi;
}) => {
  const { db, unitOfWork, clock, events } = deps;
  const stock = drizzleStockItemRepository(db);
  const reservations = drizzleReservationRepository(db);
  const products = catalogGateway(deps.catalog);
  const reservationDeps = { stock, reservations, events, unitOfWork, clock };
  return {
    routes: inventoryRoutes({
      receiveStock: receiveStock({ stock, products, unitOfWork }),
      getStock: getStock({ queries: drizzleStockQueries(db), products }),
      idempotency: deps.idempotency,
    }),
    /** 注文コンテキストのイベントの購読（コレオグラフィ型の Saga の在庫側） */
    subscriptions: orderingEventSubscriptions({
      reserveStock: reserveStock(reservationDeps),
      releaseStock: releaseStock(reservationDeps),
      fulfillStock: fulfillStock(reservationDeps),
    }),
  };
};
