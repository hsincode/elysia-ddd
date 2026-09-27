import { Elysia, t } from "elysia";
import type { IdempotencyStore } from "#shared/application/idempotency";
import { IdempotencyHeaders, idempotency } from "#shared/presentation/idempotency";
import { Problem, problemResponder } from "#shared/presentation/problem";
import type { ReceiveStock, ReceiveStockError } from "../application/receive-stock";
import type { GetStock } from "../application/stock-queries";

const StockResponse = t.Object({
  productId: t.String({ format: "uuid" }),
  onHand: t.Integer({ description: "倉庫にある数" }),
  reserved: t.Integer({ description: "そのうち注文に引き当て済みの数" }),
  available: t.Integer({ description: "まだ引き当てられる数" }),
});

const StockParams = t.Object({ productId: t.String({ format: "uuid" }) });

const problem = problemResponder({
  InvalidQuantity: 422,
  StockLimitExceeded: 422,
  ProductNotFound: 404,
} as const satisfies Record<ReceiveStockError["type"], number>);

export const inventoryRoutes = (deps: {
  receiveStock: ReceiveStock;
  getStock: GetStock;
  idempotency: IdempotencyStore;
}) => {
  const idempotent = idempotency(deps.idempotency);
  const reload = async (productId: string) => {
    const stock = await deps.getStock(productId);
    if (!stock.ok) throw new Error(`stock for ${productId} not found right after writing it`);
    return stock.value;
  };

  return new Elysia({ prefix: "/inventory", tags: ["inventory"] })
    .get(
      "/:productId",
      async ({ params }) => {
        const stock = await deps.getStock(params.productId);
        return stock.ok ? stock.value : problem(stock.error);
      },
      {
        params: StockParams,
        response: { 200: StockResponse, 404: Problem },
        detail: { summary: "在庫を見る", description: "カタログにある商品なら、まだ入荷していなくても 0 を返す" },
      },
    )
    .post(
      "/:productId/receipts",
      (context) =>
        idempotent(context, async () => {
          const result = await deps.receiveStock({
            productId: context.params.productId,
            quantity: context.body.quantity,
          });
          if (!result.ok) return problem(result.error);
          return reload(context.params.productId);
        }),
      {
        params: StockParams,
        headers: IdempotencyHeaders,
        body: t.Object({ quantity: t.Integer() }),
        response: { 200: StockResponse, 404: Problem, 422: Problem },
        detail: {
          summary: "入荷を記録する",
          description: "同じ入荷を二重に数えないよう、Idempotency-Key を付けて送ることを勧める",
        },
      },
    );
};
