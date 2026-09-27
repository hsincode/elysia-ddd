/**
 * 同時更新の衝突（楽観ロックの version 不一致、DB が検出したシリアライゼーション失敗やデッドロック）。
 * 読み直してやり直せば通りうるので、HTTP では 409 にし、イベントの配送ではリトライに回す。
 */
export class ConcurrencyError extends Error {
  override readonly name = "ConcurrencyError";
}

/**
 * ConcurrencyError のときだけ work をやり直す。トランザクションごとやり直すので、
 * DB の外に副作用を持たない処理（メール送信などを含まない処理）にだけ使う。
 */
export async function retryOnConflict<T>(work: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof ConcurrencyError) || attempt >= attempts) throw error;
    }
  }
}
