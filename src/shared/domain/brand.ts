declare const brand: unique symbol;

/**
 * 実体は T のまま、型だけを区別する。OrderId と ProductId を取り違えない、検証済みの値だけを通す、に使う。
 * ブランド付きの値を作るのは各 Value Object のファクトリだけにする。
 */
export type Brand<T, Name extends string> = T & { readonly [brand]: Name };
