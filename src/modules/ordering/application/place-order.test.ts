import { describe, expect, test } from "bun:test";
import { Money } from "#shared/domain/money";
import { unwrap } from "#shared/domain/result";
import { fixedClock, inlineUnitOfWork, recordingPublisher, sequentialIds } from "#test/support/fakes";
import { type Order, type OrderId, ProductId } from "../domain/order";
import type { OrderRepository } from "../domain/order-repository";
import { placeOrder } from "./place-order";
import type { ProductCatalog } from "./product-catalog";

// ユースケースはポートにしか依存しないので、インメモリの実装を差し込めば DB 無しで試せる
class InMemoryOrderRepository implements OrderRepository {
  readonly orders = new Map<OrderId, Order>();
  async findById(id: OrderId) {
    return this.orders.get(id) ?? null;
  }
  async findUnconfirmedPlacedBy(cutoff: Date) {
    return [...this.orders.values()]
      .filter((order) => order.state.status === "placed" && order.placedAt <= cutoff)
      .map((order) => order.id);
  }
  async save(order: Order) {
    this.orders.set(order.id, order);
  }
}

const catalogOf = (...products: { id: string; name: string; price: number }[]): ProductCatalog => ({
  async findOrderable(ids) {
    return new Map(
      products
        .filter((product) => ids.includes(ProductId(product.id)))
        .map((product) => {
          const id = ProductId(product.id);
          return [id, { id, name: product.name, unitPrice: unwrap(Money.of(product.price)) }] as const;
        }),
    );
  },
});

const setup = (catalog: ProductCatalog) => {
  const orders = new InMemoryOrderRepository();
  const events = recordingPublisher();
  const execute = placeOrder({
    orders,
    catalog,
    events,
    unitOfWork: inlineUnitOfWork,
    clock: fixedClock(),
    ids: sequentialIds(),
  });
  return { orders, events, execute };
};

const customerId = "01900000-0000-7000-8000-00000000c001";

describe("placeOrder", () => {
  test("注文時点のカタログの単価で注文を作って保存し、OrderPlaced を積む", async () => {
    const { orders, events, execute } = setup(catalogOf({ id: "p1", name: "コーヒー豆", price: 1200 }));
    const { orderId } = unwrap(await execute({ customerId, lines: [{ productId: "p1", quantity: 2 }] }));
    const saved = orders.orders.get(orderId);
    expect<number | undefined>(saved?.total).toBe(2400);
    expect(saved?.lines[0]?.productName).toBe("コーヒー豆");
    expect(events.published.map((event) => event.type)).toEqual(["ordering.OrderPlaced"]);
  });

  test("注文できない商品が含まれていれば、何も保存せずイベントも積まない", async () => {
    const { orders, events, execute } = setup(catalogOf({ id: "p1", name: "コーヒー豆", price: 1200 }));
    const result = await execute({
      customerId,
      lines: [
        { productId: "p1", quantity: 1 },
        { productId: "p2", quantity: 1 },
      ],
    });
    expect(result).toEqual({ ok: false, error: { type: "ProductUnavailable", productIds: ["p2"] } });
    expect(orders.orders.size).toBe(0);
    expect(events.published).toEqual([]);
  });

  test("依頼の形が誤っていれば、カタログに問い合わせる前に断る", async () => {
    const { execute } = setup({ findOrderable: () => Promise.reject(new Error("ここまで来てはいけない")) });
    expect(await execute({ customerId, lines: [{ productId: "p1", quantity: 0 }] })).toEqual({
      ok: false,
      error: { type: "InvalidQuantity", quantity: 0, productId: "p1" },
    });
    const tooMany = Array.from({ length: 51 }, (_, i) => ({ productId: `p${i}`, quantity: 1 }));
    expect(await execute({ customerId, lines: tooMany })).toEqual({
      ok: false,
      error: { type: "TooManyOrderLines", count: 51, limit: 50 },
    });
  });
});
