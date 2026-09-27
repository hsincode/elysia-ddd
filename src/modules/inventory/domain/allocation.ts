import type { Shortage, StockReservationFailed, StockReserved } from "./inventory-events";
import { type OrderId, Reservation, type ReservationLine } from "./reservation";
import { type ProductId, Quantity, StockItem } from "./stock-item";

export type Allocation =
  | Readonly<{ outcome: "reserved"; reservation: Reservation; items: readonly StockItem[]; event: StockReserved }>
  | Readonly<{
      outcome: "rejected";
      reservation: Reservation;
      shortages: readonly Shortage[];
      event: StockReservationFailed;
    }>;

/** 同じ商品の行を 1 行にまとめる（上流が重複を許すようになっても数え間違えない） */
const merge = (lines: readonly ReservationLine[]): ReservationLine[] => {
  const totals = new Map<ProductId, number>();
  for (const { productId, quantity } of lines) totals.set(productId, (totals.get(productId) ?? 0) + quantity);
  return [...totals].map(([productId, total]) => {
    const quantity = Quantity.of(total);
    if (!quantity.ok) throw new RangeError(`requested quantity out of range for ${productId}: ${total}`);
    return { productId, quantity: quantity.value };
  });
};

/**
 * 注文 1 件分の在庫を「全部引き当てるか、何も引き当てないか」で決める（ドメインサービス）。
 * 複数の StockItem にまたがる判断なので、どの集約のメソッドにもできない。
 * stock に無い商品は一度も入荷していない（在庫 0）として扱う。
 */
export function allocate(input: {
  orderId: OrderId;
  lines: readonly ReservationLine[];
  stock: ReadonlyMap<ProductId, StockItem>;
  now: Date;
}): Allocation {
  const lines = merge(input.lines);
  const items: StockItem[] = [];
  const shortages: Shortage[] = [];
  for (const line of lines) {
    const item = input.stock.get(line.productId) ?? StockItem.empty(line.productId);
    const reserved = item.reserve(line.quantity);
    if (reserved.ok) items.push(reserved.value);
    else shortages.push({ productId: line.productId, requested: line.quantity, available: reserved.error.available });
  }

  const base = { aggregateId: input.orderId, occurredAt: input.now };
  if (shortages.length > 0) {
    return {
      outcome: "rejected",
      reservation: Reservation.rejected(input.orderId),
      shortages,
      event: { ...base, type: "inventory.StockReservationFailed", payload: { orderId: input.orderId, shortages } },
    };
  }
  return {
    outcome: "reserved",
    reservation: Reservation.reserved(input.orderId, lines),
    items,
    event: { ...base, type: "inventory.StockReserved", payload: { orderId: input.orderId } },
  };
}
