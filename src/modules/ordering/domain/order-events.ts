import type { DomainEvent } from "#shared/domain/domain-event";

/** イベントは他のモジュールへそのまま渡るので、ブランド型ではなく素の値で持つ（Published Language） */
export type OrderLineSnapshot = Readonly<{ productId: string; quantity: number; unitPrice: number }>;

export type OrderPlaced = DomainEvent<
  "ordering.OrderPlaced",
  Readonly<{ customerId: string; lines: readonly OrderLineSnapshot[]; total: number }>
>;

export type OrderConfirmed = DomainEvent<"ordering.OrderConfirmed", Readonly<Record<string, never>>>;

export type OrderRejected = DomainEvent<
  "ordering.OrderRejected",
  Readonly<{ unavailableProductIds: readonly string[] }>
>;

/** お客様の取消も、期限切れによるシステムの取消も、このイベント 1 つで伝える */
export type OrderCancelled = DomainEvent<
  "ordering.OrderCancelled",
  Readonly<{ reason: string; cancelledBy: "customer" | "system" }>
>;

export type OrderShipped = DomainEvent<
  "ordering.OrderShipped",
  Readonly<{ trackingNumber: string; lines: readonly OrderLineSnapshot[] }>
>;

export type OrderingEvent = OrderPlaced | OrderConfirmed | OrderRejected | OrderCancelled | OrderShipped;
