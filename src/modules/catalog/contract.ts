/**
 * カタログコンテキストの公開窓口。他のモジュールが import してよいのはこのファイルだけ。
 * ここの型は外部との約束なので、内部のモデルを変えても形は変えない。
 */
export type CatalogProduct = Readonly<{ id: string; name: string; price: number; onSale: boolean }>;

export interface CatalogApi {
  /** 指定した ID の商品を返す（存在しない ID は結果に含まれない） */
  findProducts(ids: readonly string[]): Promise<CatalogProduct[]>;
}
