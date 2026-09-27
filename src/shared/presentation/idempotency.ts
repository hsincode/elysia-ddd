import { ElysiaCustomStatusResponse, status, t } from "elysia";
import type { IdempotencyStore, RecordedResponse } from "#shared/application/idempotency";

/** ルートの headers に指定すると、OpenAPI に載り、形も検証される */
export const IdempotencyHeaders = t.Object({
  "idempotency-key": t.Optional(
    t.String({
      minLength: 1,
      maxLength: 255,
      pattern: "^[\\x21-\\x7e]+$",
      description: "やり直しても 1 回しか実行されないようにするキー（UUID など）。同じキーは 24 時間有効",
    }),
  ),
});

/** 再送のときにも返したいヘッダー */
const REPLAYED_HEADERS = ["location"];

type RouteContext = Readonly<{
  request: Request;
  headers: Readonly<Record<string, string | undefined>>;
  body: unknown;
  set: { headers: Record<string, unknown> };
}>;

/** キーの順番に左右されない JSON（同じ内容なら同じ文字列） */
const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  ) ?? "";

const record = (result: unknown, headers: Record<string, unknown>): RecordedResponse => {
  const isStatus = result instanceof ElysiaCustomStatusResponse;
  return {
    status: isStatus ? Number(result.code) : 200,
    body: isStatus ? result.response : result,
    headers: Object.fromEntries(
      REPLAYED_HEADERS.flatMap((name) => (typeof headers[name] === "string" ? [[name, headers[name]]] : [])),
    ),
  };
};

/**
 * Idempotency-Key 付きの POST を 1 回だけ実行するためのラッパー。
 * - キーが無ければそのまま実行する
 * - 同じキー・同じボディなら、前回の応答をそのまま返す（Idempotent-Replayed: true）
 * - 同じキー・違うボディなら 422 で断る（キーの使い回しはクライアントのバグ）
 */
export const idempotency =
  (store: IdempotencyStore) =>
  async <R>(context: RouteContext, work: () => Promise<R>): Promise<R> => {
    const key = context.headers["idempotency-key"];
    if (key === undefined) return work();

    const { request, set } = context;
    const outcome = await store.execute(
      {
        scope: `${request.method} ${new URL(request.url).pathname}`,
        key,
        fingerprint: new Bun.CryptoHasher("sha256").update(canonicalJson(context.body)).digest("hex"),
      },
      async () => {
        const result = await work();
        return { result, response: record(result, set.headers) };
      },
    );

    switch (outcome.kind) {
      case "executed":
        return outcome.result;
      case "replayed":
        Object.assign(set.headers, outcome.response.headers, { "idempotent-replayed": "true" });
        return status(outcome.response.status, outcome.response.body) as R;
      case "mismatch":
        return status(422, {
          type: "urn:problem:IdempotencyKeyReused",
          title: "Idempotency key reused",
          status: 422,
          detail: "The Idempotency-Key was already used for a request with a different body.",
        }) as R;
    }
  };
