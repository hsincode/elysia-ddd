import { Elysia, status, t } from "elysia";
import type { IdempotencyStore } from "#shared/application/idempotency";
import { IdempotencyHeaders, idempotency } from "#shared/presentation/idempotency";
import { Problem, problemResponder } from "#shared/presentation/problem";
import type { CancelOrder, CancelOrderError } from "../application/cancel-order";
import type { OrderQueries } from "../application/order-queries";
import type { PlaceOrder, PlaceOrderError } from "../application/place-order";
import type { ShipOrder, ShipOrderError } from "../application/ship-order";

const OrderResponse = t.Object({
  id: t.String({ format: "uuid" }),
  customerId: t.String({ format: "uuid" }),
  status: t.UnionEnum(["placed", "confirmed", "shipped", "cancelled", "rejected"], {
    description:
      "placed: 在庫の確保待ち / confirmed: 確保済み / shipped: 出荷済み / cancelled: 取消 / rejected: 在庫不足で却下",
  }),
  lines: t.Array(
    t.Object({
      productId: t.String({ format: "uuid" }),
      productName: t.String(),
      unitPrice: t.Integer(),
      quantity: t.Integer(),
      subtotal: t.Integer(),
    }),
  ),
  total: t.Integer(),
  placedAt: t.Date(),
  confirmedAt: t.Nullable(t.Date()),
  shipment: t.Nullable(t.Object({ at: t.Date(), trackingNumber: t.String() })),
  cancellation: t.Nullable(t.Object({ at: t.Date(), by: t.UnionEnum(["customer", "system"]), reason: t.String() })),
  rejection: t.Nullable(t.Object({ at: t.Date(), unavailableProductIds: t.Array(t.String({ format: "uuid" })) })),
  actions: t.Array(t.UnionEnum(["cancel", "ship"]), { description: "いまできる操作" }),
});

const OrderParams = t.Object({ id: t.String({ format: "uuid" }) });

const problem = problemResponder({
  EmptyOrder: 422,
  TooManyOrderLines: 422,
  DuplicateOrderLine: 422,
  InvalidQuantity: 422,
  ProductUnavailable: 422,
  OrderTotalLimitExceeded: 422,
  InvalidCancelReason: 422,
  InvalidTrackingNumber: 422,
  OrderNotFound: 404,
  InvalidOrderTransition: 409,
} as const satisfies Record<(PlaceOrderError | CancelOrderError | ShipOrderError)["type"], number>);

export const orderingRoutes = (deps: {
  placeOrder: PlaceOrder;
  cancelOrder: CancelOrder;
  shipOrder: ShipOrder;
  queries: OrderQueries;
  idempotency: IdempotencyStore;
}) => {
  const idempotent = idempotency(deps.idempotency);
  const reload = async (id: string) => {
    const order = await deps.queries.findById(id);
    if (!order) throw new Error(`order ${id} not found right after writing it`);
    return order;
  };

  return new Elysia({ prefix: "/orders", tags: ["ordering"] })
    .post(
      "",
      (context) =>
        idempotent(context, async () => {
          const result = await deps.placeOrder(context.body);
          if (!result.ok) return problem(result.error);
          context.set.headers.location = `/orders/${result.value.orderId}`;
          return status(201, await reload(result.value.orderId));
        }),
      {
        headers: IdempotencyHeaders,
        body: t.Object({
          customerId: t.String({ format: "uuid" }),
          lines: t.Array(t.Object({ productId: t.String({ format: "uuid" }), quantity: t.Integer() })),
        }),
        response: { 201: OrderResponse, 422: Problem },
        detail: {
          summary: "注文する",
          description:
            "受け付けた注文は placed（在庫の確保待ち）。確保できると confirmed、足りなければ rejected になる",
        },
      },
    )
    .get(
      "/:id",
      async ({ params }) =>
        (await deps.queries.findById(params.id)) ?? problem({ type: "OrderNotFound", orderId: params.id }),
      {
        params: OrderParams,
        response: { 200: OrderResponse, 404: Problem },
        detail: { summary: "注文を取得" },
      },
    )
    .post(
      "/:id/cancel",
      async ({ params, body }) => {
        const result = await deps.cancelOrder({ orderId: params.id, reason: body.reason });
        if (!result.ok) return problem(result.error);
        return reload(params.id);
      },
      {
        params: OrderParams,
        body: t.Object({ reason: t.String() }),
        response: { 200: OrderResponse, 404: Problem, 409: Problem, 422: Problem },
        detail: { summary: "注文を取り消す", description: "出荷する前（placed / confirmed）なら取り消せる" },
      },
    )
    .post(
      "/:id/ship",
      async ({ params, body }) => {
        const result = await deps.shipOrder({ orderId: params.id, trackingNumber: body.trackingNumber });
        if (!result.ok) return problem(result.error);
        return reload(params.id);
      },
      {
        params: OrderParams,
        body: t.Object({ trackingNumber: t.String() }),
        response: { 200: OrderResponse, 404: Problem, 409: Problem, 422: Problem },
        detail: { summary: "出荷を記録する", description: "確定（confirmed）した注文だけが出荷できる" },
      },
    );
};
