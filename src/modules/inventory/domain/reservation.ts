import type { Brand } from "#shared/domain/brand";
import { err, ok, type Result } from "#shared/domain/result";
import type { ProductId, Quantity } from "./stock-item";

/** 引当の相手になる注文の ID */
export type OrderId = Brand<string, "OrderId">;
export const OrderId = (value: string) => value as OrderId;

export type ReservationLine = Readonly<{ productId: ProductId; quantity: Quantity }>;

/**
 *   reserved ──release──▶ released
 *       └────fulfill───▶ fulfilled
 *   rejected: 在庫が足りず、何も引き当てなかった
 *   voided:   引当より先に取消が届いた（あとから来る引当の依頼を断るための記録）
 */
export type ReservationStatus = "reserved" | "rejected" | "released" | "fulfilled" | "voided";

export type ReservationAlreadyFulfilled = { readonly type: "ReservationAlreadyFulfilled"; readonly orderId: OrderId };
export type ReservationNotHeld = {
  readonly type: "ReservationNotHeld";
  readonly orderId: OrderId;
  readonly status: ReservationStatus;
};

/**
 * 注文 1 件分の引当の記録（集約ルート）。どの注文に何を引き当てたかを覚えておくことで、
 * イベントが重複しても、順番が入れ替わって届いても、在庫を二重に動かさない。
 */
export class Reservation {
  private constructor(
    readonly orderId: OrderId,
    readonly status: ReservationStatus,
    readonly lines: readonly ReservationLine[],
    readonly version: number,
  ) {}

  static reserved(orderId: OrderId, lines: readonly ReservationLine[]): Reservation {
    return new Reservation(orderId, "reserved", lines, 0);
  }

  static rejected(orderId: OrderId): Reservation {
    return new Reservation(orderId, "rejected", [], 0);
  }

  static voided(orderId: OrderId): Reservation {
    return new Reservation(orderId, "voided", [], 0);
  }

  /** 保存済みの状態から復元する。リポジトリ専用 */
  static reconstitute(state: {
    orderId: OrderId;
    status: ReservationStatus;
    lines: readonly ReservationLine[];
    version: number;
  }): Reservation {
    return new Reservation(state.orderId, state.status, state.lines, state.version);
  }

  /** 引当を戻す。何も持っていなければ何もしない（冪等）。出荷済みは戻せない */
  release(): Result<{ reservation: Reservation; released: readonly ReservationLine[] }, ReservationAlreadyFulfilled> {
    switch (this.status) {
      case "reserved":
        return ok({ reservation: this.to("released"), released: this.lines });
      case "fulfilled":
        return err({ type: "ReservationAlreadyFulfilled", orderId: this.orderId });
      default:
        return ok({ reservation: this, released: [] });
    }
  }

  /** 出荷で引当を確定する。確定済みなら何もしない（冪等）。引き当てていない注文は出荷できない */
  fulfill(): Result<{ reservation: Reservation; fulfilled: readonly ReservationLine[] }, ReservationNotHeld> {
    switch (this.status) {
      case "reserved":
        return ok({ reservation: this.to("fulfilled"), fulfilled: this.lines });
      case "fulfilled":
        return ok({ reservation: this, fulfilled: [] });
      default:
        return err({ type: "ReservationNotHeld", orderId: this.orderId, status: this.status });
    }
  }

  private to(status: ReservationStatus): Reservation {
    return new Reservation(this.orderId, status, this.lines, this.version);
  }
}
