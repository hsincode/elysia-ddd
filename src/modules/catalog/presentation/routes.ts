import { Elysia, status, t } from "elysia";
import { Problem, problemResponder } from "#shared/presentation/problem";
import type { DiscontinueProduct, DiscontinueProductError } from "../application/discontinue-product";
import type { ProductQueries } from "../application/product-queries";
import type { RegisterProduct, RegisterProductError } from "../application/register-product";

const ProductResponse = t.Object({
  id: t.String({ format: "uuid" }),
  name: t.String(),
  price: t.Integer({ description: "価格（円）" }),
  status: t.UnionEnum(["on_sale", "discontinued"]),
  unitsSold: t.Integer({ description: "販売数。注文イベントから非同期に集計するので、注文直後は反映前のことがある" }),
  registeredAt: t.Date(),
});

const ProductParams = t.Object({ id: t.String({ format: "uuid" }) });

const problem = problemResponder({
  InvalidProductName: 422,
  InvalidMoney: 422,
  ProductNotFound: 404,
  ProductAlreadyDiscontinued: 409,
} as const satisfies Record<RegisterProductError["type"] | DiscontinueProductError["type"], number>);

/** HTTP の入口。入力の形を検証してユースケースを呼び、Result を HTTP の応答に変えるだけで、判断はしない */
export const catalogRoutes = (deps: {
  registerProduct: RegisterProduct;
  discontinueProduct: DiscontinueProduct;
  queries: ProductQueries;
}) => {
  const reload = async (id: string) => {
    const product = await deps.queries.findById(id);
    if (!product) throw new Error(`product ${id} not found right after writing it`);
    return product;
  };

  return new Elysia({ prefix: "/products", tags: ["catalog"] })
    .get("", ({ query }) => deps.queries.list({ sort: query.sort ?? "newest", limit: query.limit ?? 50 }), {
      query: t.Object({
        sort: t.Optional(t.UnionEnum(["newest", "popular"])),
        limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
      }),
      response: { 200: t.Array(ProductResponse) },
      detail: { summary: "商品一覧" },
    })
    .get(
      "/:id",
      async ({ params }) =>
        (await deps.queries.findById(params.id)) ?? problem({ type: "ProductNotFound", productId: params.id }),
      {
        params: ProductParams,
        response: { 200: ProductResponse, 404: Problem },
        detail: { summary: "商品を取得" },
      },
    )
    .post(
      "",
      async ({ body, set }) => {
        const result = await deps.registerProduct(body);
        if (!result.ok) return problem(result.error);
        set.headers.location = `/products/${result.value.productId}`;
        return status(201, await reload(result.value.productId));
      },
      {
        body: t.Object({ name: t.String(), price: t.Integer({ description: "価格（円）" }) }),
        response: { 201: ProductResponse, 422: Problem },
        detail: { summary: "商品を登録" },
      },
    )
    .post(
      "/:id/discontinue",
      async ({ params }) => {
        const result = await deps.discontinueProduct({ productId: params.id });
        if (!result.ok) return problem(result.error);
        return reload(params.id);
      },
      {
        params: ProductParams,
        response: { 200: ProductResponse, 404: Problem, 409: Problem },
        detail: { summary: "販売を終了" },
      },
    );
};
