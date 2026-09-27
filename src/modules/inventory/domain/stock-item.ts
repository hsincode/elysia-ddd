import type { Brand } from "#shared/domain/brand";
import { err, ok, type Result } from "#shared/domain/result";

/** 在庫から見た商品の ID */
export type ProductId = Brand<string, "ProductId">;
export const ProductId = (value: string) => value as ProductId;

/** 1 商品あたりの在庫の上限。入荷数の打ち間違い（桁違い）を止める */
export const MAX_ON_HAND = 1_000_000;

/** 入荷・引当の数量（1 以上の整数） */
export type Quantity = Brand<number, "Quantity">;
export type InvalidQuantity = { readonly type: "InvalidQuantity"; readonly quantity: number };
export const Quantity = {
  of(value: number): Result<Quantity, InvalidQuantity> {
    return Number.isSafeInteger(value) && value >= 1 && value <= MAX_ON_HAND
      ? ok(value as Quantity)
      : err({ type: "InvalidQuantity", quantity: value });
  },
};

export type InsufficientStock = {
  readonly type: "InsufficientStock";
  readonly productId: ProductId;
  readonly requested: number;
  readonly available: number;
};
export type StockLimitExceeded = {
  readonly type: "StockLimitExceeded";
  readonly productId: ProductId;
  readonly onHand: number;
  readonly limit: number;
};

/**
 * 商品ごとの在庫（集約ルート）。不変条件は 0 ≤ reserved ≤ onHand ≤ MAX_ON_HAND。
 * onHand は倉庫にある数、reserved はそのうち注文に引き当て済みの数、available はまだ引き当てられる数。
 */
export class StockItem {
  private constructor(
    readonly productId: ProductId,
    readonly onHand: number,
    readonly reserved: number,
    /** 楽観ロック用。まだ保存していない集約は 0 */
    readonly version: number,
  ) {}

  /** 一度も入荷していない商品。在庫 0 として扱う */
  static empty(productId: ProductId): StockItem {
    return new StockItem(productId, 0, 0, 0);
  }

  /** 保存済みの状態から復元する。リポジトリ専用 */
  static reconstitute(state: { productId: ProductId; onHand: number; reserved: number; version: number }): StockItem {
    return new StockItem(state.productId, state.onHand, state.reserved, state.version);
  }

  get available(): number {
    return this.onHand - this.reserved;
  }

  receive(quantity: Quantity): Result<StockItem, StockLimitExceeded> {
    const onHand = this.onHand + quantity;
    if (onHand > MAX_ON_HAND) {
      return err({ type: "StockLimitExceeded", productId: this.productId, onHand, limit: MAX_ON_HAND });
    }
    return ok(this.with(onHand, this.reserved));
  }

  reserve(quantity: Quantity): Result<StockItem, InsufficientStock> {
    if (quantity > this.available) {
      return err({
        type: "InsufficientStock",
        productId: this.productId,
        requested: quantity,
        available: this.available,
      });
    }
    return ok(this.with(this.onHand, this.reserved + quantity));
  }

  /** 引当を戻す。引き当てた以上を戻すのは引当記録（Reservation）との食い違いで、バグなので投げる */
  release(quantity: Quantity): StockItem {
    if (quantity > this.reserved) {
      throw new Error(`cannot release ${quantity} of ${this.productId}: only ${this.reserved} reserved`);
    }
    return this.with(this.onHand, this.reserved - quantity);
  }

  /** 出荷。引き当てていた分を、引当と在庫の両方から減らす */
  fulfill(quantity: Quantity): StockItem {
    if (quantity > this.reserved) {
      throw new Error(`cannot fulfill ${quantity} of ${this.productId}: only ${this.reserved} reserved`);
    }
    return this.with(this.onHand - quantity, this.reserved - quantity);
  }

  private with(onHand: number, reserved: number): StockItem {
    return new StockItem(this.productId, onHand, reserved, this.version);
  }
}
