import type { DomainEvent } from "#shared/domain/domain-event";

export type Shortage = Readonly<{ productId: string; requested: number; available: number }>;

/** 注文 1 件分の在庫をすべて引き当てた。aggregateId は注文 ID（引当の記録は注文ごと） */
export type StockReserved = DomainEvent<"inventory.StockReserved", Readonly<{ orderId: string }>>;

/** 足りない商品があったので、何も引き当てなかった */
export type StockReservationFailed = DomainEvent<
  "inventory.StockReservationFailed",
  Readonly<{ orderId: string; shortages: readonly Shortage[] }>
>;

export type InventoryEvent = StockReserved | StockReservationFailed;
