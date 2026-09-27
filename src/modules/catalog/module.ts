import type { Clock, IdGenerator, UnitOfWork } from "#shared/application/ports";
import type { CurrentDb } from "#shared/infrastructure/transaction";
import { catalogApi } from "./application/catalog-api";
import { discontinueProduct } from "./application/discontinue-product";
import { registerProduct } from "./application/register-product";
import { drizzleProductQueries } from "./infrastructure/drizzle-product-queries";
import { drizzleProductRepository } from "./infrastructure/drizzle-product-repository";
import { salesProjection } from "./infrastructure/sales-projection";
import { catalogRoutes } from "./presentation/routes";

/** カタログコンテキストの組み立て（モジュール内のコンポジションルート）。呼ぶのは bootstrap.ts だけ */
export const createCatalogModule = (deps: {
  db: CurrentDb;
  unitOfWork: UnitOfWork;
  clock: Clock;
  ids: IdGenerator;
}) => {
  const { db, unitOfWork, clock, ids } = deps;
  const products = drizzleProductRepository(db);
  const queries = drizzleProductQueries(db);
  return {
    routes: catalogRoutes({
      registerProduct: registerProduct({ products, unitOfWork, clock, ids }),
      discontinueProduct: discontinueProduct({ products, unitOfWork }),
      queries,
    }),
    /** 他のモジュールへ公開する API（contract.ts の実装） */
    api: catalogApi(queries),
    /** 他のモジュールのイベントの購読 */
    subscriptions: salesProjection(db),
  };
};
