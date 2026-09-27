/** 記録しておき、同じリクエストがもう一度来たときにそのまま返す応答 */
export type RecordedResponse = Readonly<{ status: number; body: unknown; headers: Readonly<Record<string, string>> }>;

export type IdempotentRequest = Readonly<{
  /** キーの有効範囲（メソッドとパス）。別のエンドポイントで同じキーが使われても混ざらない */
  scope: string;
  key: string;
  /** リクエストボディの要約（フィンガープリント）。同じキーで違うボディが来たら取り違えとして断る */
  fingerprint: string;
}>;

export type IdempotentOutcome<T> =
  | { readonly kind: "executed"; readonly result: T }
  | { readonly kind: "replayed"; readonly response: RecordedResponse }
  | { readonly kind: "mismatch" };

/**
 * 冪等キーの記録。クライアントがタイムアウトなどで同じ POST をやり直しても、処理は 1 回だけにする。
 */
export interface IdempotencyStore {
  /**
   * 同じ scope と key の記録があれば実行せずに記録を返し、無ければ work を実行して応答を記録する。
   * 記録と work の書き込みは同じトランザクションで確定するので、「実行したのに記録が無い」状態は残らない。
   * 同じキーの同時リクエストは、先の方が終わるまで待ってから記録を返す。
   */
  execute<T>(
    request: IdempotentRequest,
    work: () => Promise<{ result: T; response: RecordedResponse }>,
  ): Promise<IdempotentOutcome<T>>;
}
