export type OrderView = Readonly<{
  id: string;
  customerId: string;
  status: "placed" | "confirmed" | "shipped" | "cancelled" | "rejected";
  lines: Readonly<{
    productId: string;
    productName: string;
    unitPrice: number;
    quantity: number;
    subtotal: number;
  }>[];
  total: number;
  placedAt: Date;
  confirmedAt: Date | null;
  shipment: Readonly<{ at: Date; trackingNumber: string }> | null;
  cancellation: Readonly<{ at: Date; by: "customer" | "system"; reason: string }> | null;
  rejection: Readonly<{ at: Date; unavailableProductIds: string[] }> | null;
  /** いまお客様・運用者ができる操作（ドメインの状態遷移表から作る。クライアントは表を二重に持たなくてよい） */
  actions: ("cancel" | "ship")[];
}>;

/** 参照系の出口（CQRS の Q 側） */
export interface OrderQueries {
  findById(id: string): Promise<OrderView | null>;
}
