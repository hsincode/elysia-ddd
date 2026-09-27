import type { Brand } from "#shared/domain/brand";
import type { Money } from "#shared/domain/money";
import { err, ok, type Result } from "#shared/domain/result";
import { graphemeLength, hasControlCharacters, normalizeText } from "#shared/domain/text";

export type ProductId = Brand<string, "ProductId">;
export const ProductId = (value: string) => value as ProductId;

const MAX_NAME_LENGTH = 100;

/**
 * 商品名。NFC に正規化して前後の空白（全角を含む）を落とし、見た目の文字数で 1〜100 文字。制御文字は入れない。
 * 「が」と「か + ゛」のように見た目が同じ名前を、同じ文字列として保存するため。
 */
export type ProductName = Brand<string, "ProductName">;
export type InvalidProductName = {
  readonly type: "InvalidProductName";
  readonly name: string;
  readonly reason: "empty" | "too_long" | "control_character";
};
export const ProductName = {
  of(raw: string): Result<ProductName, InvalidProductName> {
    const name = normalizeText(raw);
    const length = graphemeLength(name);
    if (length === 0) return err({ type: "InvalidProductName", name: raw, reason: "empty" });
    if (length > MAX_NAME_LENGTH) return err({ type: "InvalidProductName", name: raw, reason: "too_long" });
    if (hasControlCharacters(name)) return err({ type: "InvalidProductName", name: raw, reason: "control_character" });
    return ok(name as ProductName);
  },
};

export type ProductStatus = "on_sale" | "discontinued";

export type ProductAlreadyDiscontinued = { readonly type: "ProductAlreadyDiscontinued"; readonly productId: ProductId };

/**
 * 商品（集約ルート）。コンストラクタを閉じ、生成は register / reconstitute からだけにする。
 * 状態を変える操作は新しいインスタンスを返し、自分自身は書き換えない。
 */
export class Product {
  private constructor(
    readonly id: ProductId,
    readonly name: ProductName,
    readonly price: Money,
    readonly status: ProductStatus,
    readonly registeredAt: Date,
    /** 楽観ロック用。まだ保存していない集約は 0 */
    readonly version: number,
  ) {}

  static register(input: { id: ProductId; name: ProductName; price: Money; now: Date }): Product {
    return new Product(input.id, input.name, input.price, "on_sale", input.now, 0);
  }

  /** 保存済みの状態から復元する。リポジトリ専用 */
  static reconstitute(state: {
    id: ProductId;
    name: ProductName;
    price: Money;
    status: ProductStatus;
    registeredAt: Date;
    version: number;
  }): Product {
    return new Product(state.id, state.name, state.price, state.status, state.registeredAt, state.version);
  }

  discontinue(): Result<Product, ProductAlreadyDiscontinued> {
    if (this.status === "discontinued") return err({ type: "ProductAlreadyDiscontinued", productId: this.id });
    return ok(new Product(this.id, this.name, this.price, "discontinued", this.registeredAt, this.version));
  }
}
