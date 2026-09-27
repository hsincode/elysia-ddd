import type { EventPublisher } from "#shared/application/events";
import type { Clock, UnitOfWork } from "#shared/application/ports";
import { ok, type Result, unwrap } from "#shared/domain/result";
import { allocate } from "../domain/allocation";
import type { ReservationRepository, StockItemRepository } from "../domain/repositories";
import { OrderId, Reservation, type ReservationLine } from "../domain/reservation";
import { ProductId, Quantity, type StockItem } from "../domain/stock-item";

type Deps = {
  stock: StockItemRepository;
  reservations: ReservationRepository;
  events: EventPublisher;
  unitOfWork: UnitOfWork;
  clock: Clock;
};

/** 注文の出来事への反応。何をしたかをテストやログのために返す */
export type ReservationOutcome = "reserved" | "rejected" | "released" | "fulfilled" | "voided" | "skipped";

const lockedItem = (stock: ReadonlyMap<ProductId, StockItem>, productId: ProductId): StockItem => {
  const item = stock.get(productId);
  // 引き当てた商品の在庫行が無いのは、引当記録と在庫の食い違い（バグ）
  if (!item) throw new Error(`stock item ${productId} is missing although it has a reservation`);
  return item;
};

/**
 * 注文 1 件分の在庫を引き当てる（OrderPlaced を受けて）。
 * すでに記録がある注文には何もしない。重複して届いた OrderPlaced も、取消のあとに届いた OrderPlaced（voided）もここで止まる。
 */
export const reserveStock =
  (deps: Deps) =>
  (input: Readonly<{ orderId: string; lines: readonly Readonly<{ productId: string; quantity: number }>[] }>) => {
    const orderId = OrderId(input.orderId);
    // 上流（注文）が検証済みの値。壊れていればバグなので投げて、リトライとデッドレターに任せる
    const lines: ReservationLine[] = input.lines.map((line) => ({
      productId: ProductId(line.productId),
      quantity: unwrap(Quantity.of(line.quantity)),
    }));
    return deps.unitOfWork.run(async (): Promise<Result<ReservationOutcome, never>> => {
      if (await deps.reservations.find(orderId)) return ok("skipped");
      const stock = await deps.stock.lockMany(lines.map((line) => line.productId));
      const allocation = allocate({ orderId, lines, stock, now: deps.clock.now() });
      if (allocation.outcome === "reserved") await deps.stock.save(allocation.items);
      await deps.reservations.save(allocation.reservation);
      await deps.events.publish([allocation.event]);
      return ok(allocation.outcome);
    });
  };

/**
 * 注文の取消で引当を戻す（OrderCancelled を受けて）。
 * 引当より先に取消が届いたときは voided を記録し、あとから届く OrderPlaced で引き当てないようにする。
 */
export const releaseStock = (deps: Deps) => (input: Readonly<{ orderId: string }>) => {
  const orderId = OrderId(input.orderId);
  return deps.unitOfWork.run(async (): Promise<Result<ReservationOutcome, never>> => {
    const reservation = await deps.reservations.find(orderId);
    if (!reservation) {
      await deps.reservations.save(Reservation.voided(orderId));
      return ok("voided");
    }
    const released = reservation.release();
    // 出荷済みの注文は注文側が取消を許さないので、ここに来たら不整合
    if (!released.ok) throw new Error(`order ${orderId}: ${released.error.type}`);
    if (released.value.released.length === 0) return ok("skipped");

    const stock = await deps.stock.lockMany(released.value.released.map((line) => line.productId));
    await deps.stock.save(
      released.value.released.map((line) => lockedItem(stock, line.productId).release(line.quantity)),
    );
    await deps.reservations.save(released.value.reservation);
    return ok("released");
  });
};

/** 出荷で引当を確定し、在庫から減らす（OrderShipped を受けて） */
export const fulfillStock = (deps: Deps) => (input: Readonly<{ orderId: string }>) => {
  const orderId = OrderId(input.orderId);
  return deps.unitOfWork.run(async (): Promise<Result<ReservationOutcome, never>> => {
    const reservation = await deps.reservations.find(orderId);
    // 注文は確定（＝引当済み）してからしか出荷できないので、記録が無いのは不整合
    if (!reservation) throw new Error(`order ${orderId} was shipped without a reservation`);
    const fulfilled = reservation.fulfill();
    if (!fulfilled.ok) throw new Error(`order ${orderId}: ${fulfilled.error.type} (${fulfilled.error.status})`);
    if (fulfilled.value.fulfilled.length === 0) return ok("skipped");

    const stock = await deps.stock.lockMany(fulfilled.value.fulfilled.map((line) => line.productId));
    await deps.stock.save(
      fulfilled.value.fulfilled.map((line) => lockedItem(stock, line.productId).fulfill(line.quantity)),
    );
    await deps.reservations.save(fulfilled.value.reservation);
    return ok("fulfilled");
  });
};

export type ReserveStock = ReturnType<typeof reserveStock>;
export type ReleaseStock = ReturnType<typeof releaseStock>;
export type FulfillStock = ReturnType<typeof fulfillStock>;
