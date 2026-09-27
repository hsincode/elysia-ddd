import type { Brand } from "./brand";
import { err, ok, type Result } from "./result";

/** 金額（円・0 以上の整数）。カタログと注文の両方が同じ意味で使う共有カーネル */
export type Money = Brand<number, "Money">;
export type InvalidMoney = { readonly type: "InvalidMoney"; readonly amount: number };

/** 計算結果が安全な整数の範囲を外れるのは上限チェックの漏れ（バグ）なので投げる */
const checked = (amount: number): Money => {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError(`money out of range: ${amount}`);
  return amount as Money;
};

export const Money = {
  zero: 0 as Money,
  of(amount: number): Result<Money, InvalidMoney> {
    return Number.isSafeInteger(amount) && amount >= 0 ? ok(amount as Money) : err({ type: "InvalidMoney", amount });
  },
  add: (a: Money, b: Money): Money => checked(a + b),
  /** 個数倍。count は整数（Quantity など）を渡す */
  times: (a: Money, count: number): Money => checked(a * count),
};
