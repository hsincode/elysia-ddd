/**
 * 想定内の失敗（業務ルール違反・見つからない等）は戻り値で返し、型で網羅させる。
 * 例外は想定外の障害（バグ・DB 断・楽観ロックの衝突）にだけ使う。
 */
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export function ok(): Ok<void>;
export function ok<T>(value: T): Ok<T>;
export function ok<T>(value?: T): Ok<T | undefined> {
  return { ok: true, value };
}

/** `type` のリテラルを保ったまま失敗を作る */
export const err = <const E>(error: E): Err<E> => ({ ok: false, error });

/** 失敗しないはずの Result を開ける（保存済みデータの復元など）。失敗したらバグなので投げる */
export const unwrap = <T, E>(result: Result<T, E>): T => {
  if (result.ok) return result.value;
  throw new Error(`unexpected failure: ${JSON.stringify(result.error)}`);
};
