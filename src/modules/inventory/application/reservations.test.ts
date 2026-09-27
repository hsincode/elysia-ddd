import { beforeEach, describe, expect, test } from "bun:test";
import { ConcurrencyError } from "#shared/application/errors";
import { unwrap } from "#shared/domain/result";
import { fixedClock, inlineUnitOfWork, recordingPublisher } from "#test/support/fakes";
import type { ReservationRepository, StockItemRepository } from "../domain/repositories";
import type { OrderId, Reservation } from "../domain/reservation";
import { ProductId, Quantity, StockItem } from "../domain/stock-item";
import { fulfillStock, releaseStock, reserveStock } from "./reservations";

/** 楽観ロックまで含めて DB のリポジトリと同じ約束を守るインメモリ実装 */
class InMemoryStock implements StockItemRepository {
  readonly items = new Map<ProductId, StockItem>();
  async lockMany(ids: readonly ProductId[]) {
    return new Map(ids.flatMap((id) => (this.items.has(id) ? [[id, this.items.get(id) as StockItem] as const] : [])));
  }
  async save(items: readonly StockItem[]) {
    for (const item of items) {
      if ((this.items.get(item.productId)?.version ?? 0) !== item.version) throw new ConcurrencyError("conflict");
      this.items.set(item.productId, StockItem.reconstitute({ ...item, version: item.version + 1 }));
    }
  }
}

class InMemoryReservations implements ReservationRepository {
  readonly saved = new Map<OrderId, Reservation>();
  async find(orderId: OrderId) {
    return this.saved.get(orderId) ?? null;
  }
  async save(reservation: Reservation) {
    this.saved.set(reservation.orderId, reservation);
  }
}

let stock: InMemoryStock;
let reservations: InMemoryReservations;
let events: ReturnType<typeof recordingPublisher>;
let useCases: {
  reserve: ReturnType<typeof reserveStock>;
  release: ReturnType<typeof releaseStock>;
  fulfill: ReturnType<typeof fulfillStock>;
};

const product = ProductId("01900000-0000-7000-8000-0000000000a1");
const order = { orderId: "01900000-0000-7000-8000-0000000000b1", lines: [{ productId: product, quantity: 2 }] };
const onHandAndReserved = () => {
  const item = stock.items.get(product);
  return [item?.onHand, item?.reserved];
};

beforeEach(async () => {
  stock = new InMemoryStock();
  reservations = new InMemoryReservations();
  events = recordingPublisher();
  const deps = { stock, reservations, events, unitOfWork: inlineUnitOfWork, clock: fixedClock() };
  useCases = { reserve: reserveStock(deps), release: releaseStock(deps), fulfill: fulfillStock(deps) };
  await stock.save([unwrap(StockItem.empty(product).receive(unwrap(Quantity.of(5))))]);
});

describe("在庫の引当（イベントの重複・順序の入れ替わりに強いこと）", () => {
  test("引当 → 取消 で在庫が元に戻る", async () => {
    expect(unwrap(await useCases.reserve(order))).toBe("reserved");
    expect(onHandAndReserved()).toEqual([5, 2]);
    expect(unwrap(await useCases.release(order))).toBe("released");
    expect(onHandAndReserved()).toEqual([5, 0]);
  });

  test("同じ OrderPlaced が 2 回届いても、引当は 1 回だけ", async () => {
    await useCases.reserve(order);
    expect(unwrap(await useCases.reserve(order))).toBe("skipped");
    expect(onHandAndReserved()).toEqual([5, 2]);
    expect(events.published.map((event) => event.type)).toEqual(["inventory.StockReserved"]);
  });

  test("取消が引当より先に届いたら、あとから届いた引当の依頼を断る（voided）", async () => {
    expect(unwrap(await useCases.release(order))).toBe("voided");
    expect(unwrap(await useCases.reserve(order))).toBe("skipped");
    expect(onHandAndReserved()).toEqual([5, 0]);
    expect(events.published).toEqual([]);
  });

  test("在庫不足で断った注文の取消では、何も戻さない", async () => {
    const big = { ...order, lines: [{ productId: product, quantity: 6 }] };
    expect(unwrap(await useCases.reserve(big))).toBe("rejected");
    expect(unwrap(await useCases.release(big))).toBe("skipped");
    expect(onHandAndReserved()).toEqual([5, 0]);
  });

  test("出荷で在庫から減り、出荷の知らせが重複しても二重に減らない", async () => {
    await useCases.reserve(order);
    expect(unwrap(await useCases.fulfill(order))).toBe("fulfilled");
    expect(unwrap(await useCases.fulfill(order))).toBe("skipped");
    expect(onHandAndReserved()).toEqual([3, 0]);
  });

  test("引当の無い注文の出荷は不整合なので投げる（リトライ・デッドレターで気づけるように）", async () => {
    await expect(useCases.fulfill(order)).rejects.toThrow("without a reservation");
  });
});
