/** 表示用の商品。集約とは別に、読む側が欲しい形（販売数つき）で持つ */
export type ProductView = Readonly<{
  id: string;
  name: string;
  price: number;
  status: "on_sale" | "discontinued";
  unitsSold: number;
  registeredAt: Date;
}>;

export type ProductSort = "newest" | "popular";

/** 参照系の出口。集約とリポジトリを通らずに直接読む（CQRS の Q 側） */
export interface ProductQueries {
  findById(id: string): Promise<ProductView | null>;
  findByIds(ids: readonly string[]): Promise<ProductView[]>;
  list(options: { sort: ProductSort; limit: number }): Promise<ProductView[]>;
}
