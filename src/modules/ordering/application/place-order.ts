import type { EventPublisher } from "#shared/application/events";
import type { Clock, IdGenerator, UnitOfWork } from "#shared/application/ports";
import { err, ok, type Result } from "#shared/domain/result";
import {
  CustomerId,
  type DuplicateOrderLine,
  type EmptyOrder,
  type InvalidLineQuantity,
  Order,
  OrderId,
  type OrderLine,
  OrderRequest,
  type OrderTotalLimitExceeded,
  type TooManyOrderLines,
} from "../domain/order";
import type { OrderRepository } from "../domain/order-repository";
import type { ProductCatalog } from "./product-catalog";

export type PlaceOrderInput = Readonly<{
  customerId: string;
  lines: readonly Readonly<{ productId: string; quantity: number }>[];
}>;

export type ProductUnavailable = { readonly type: "ProductUnavailable"; readonly productIds: readonly string[] };

export type PlaceOrderError =
  | EmptyOrder
  | TooManyOrderLines
  | DuplicateOrderLine
  | InvalidLineQuantity
  | ProductUnavailable
  | OrderTotalLimitExceeded;

export type PlaceOrder = ReturnType<typeof placeOrder>;

/**
 * 注文を受け付ける。受け付けた時点では在庫はまだ確保しておらず（placed）、
 * 在庫コンテキストが OrderPlaced を受けて確保し、その結果で確定（confirmed）か却下（rejected）になる。
 */
export const placeOrder =
  (deps: {
    orders: OrderRepository;
    catalog: ProductCatalog;
    events: EventPublisher;
    unitOfWork: UnitOfWork;
    clock: Clock;
    ids: IdGenerator;
  }) =>
  async (input: PlaceOrderInput): Promise<Result<{ orderId: OrderId }, PlaceOrderError>> => {
    // カタログに問い合わせる前に、依頼の形だけで分かる誤りを弾く
    const requested = OrderRequest.parse(input.lines);
    if (!requested.ok) return requested;

    // 単価と商品名は注文時点のカタログから取り、明細に写し取る
    const products = await deps.catalog.findOrderable(requested.value.map((line) => line.productId));
    const lines: OrderLine[] = [];
    const unavailable: string[] = [];
    for (const { productId, quantity } of requested.value) {
      const product = products.get(productId);
      if (product) lines.push({ productId, productName: product.name, unitPrice: product.unitPrice, quantity });
      else unavailable.push(productId);
    }
    if (unavailable.length > 0) return err({ type: "ProductUnavailable", productIds: unavailable });

    const placed = Order.place({
      id: OrderId(deps.ids.next()),
      customerId: CustomerId(input.customerId),
      lines,
      now: deps.clock.now(),
    });
    if (!placed.ok) return placed;
    const { order, event } = placed.value;

    // 集約の保存とイベントの記録を 1 トランザクションに。トランザクションは書き込みの間だけ張る
    return deps.unitOfWork.run(async () => {
      await deps.orders.save(order);
      await deps.events.publish([event]);
      return ok({ orderId: order.id });
    });
  };
