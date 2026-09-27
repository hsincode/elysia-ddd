import { status, t } from "elysia";

/** RFC 9457 Problem Details。ドメインエラーの項目（productIds など）は拡張メンバーとしてそのまま載せる */
export const Problem = t.Object(
  {
    type: t.String({ description: "問題の種類。ドメインエラーは urn:problem:<エラー名>" }),
    title: t.String(),
    status: t.Integer(),
    detail: t.Optional(t.String()),
  },
  { additionalProperties: true },
);

/** "OrderAlreadyCancelled" → "Order already cancelled" */
const titleOf = (name: string) => name.replace(/(?<=[a-z])([A-Z])/g, (letter) => ` ${letter.toLowerCase()}`);

/** Problem Details が意味を決めている項目。ドメインエラーがこの名前を持つと上書きしてしまうので、型で禁じる */
type ReservedMembers = { readonly title?: never; readonly status?: never; readonly instance?: never };

/**
 * 「エラー名 → HTTP ステータス」の表から、ユースケースの Err を Problem 応答に変える関数を作る。
 * 表に無いエラー名を渡すと型エラーになるので、エラーを増やしたときの対応漏れはコンパイル時に分かる。
 */
export const problemResponder =
  <const Table extends Record<string, number>>(table: Table) =>
  <E extends { readonly type: keyof Table & string } & ReservedMembers>({ type, ...extensions }: E) => {
    const code = table[type] as Table[E["type"]];
    return status(code, { ...extensions, type: `urn:problem:${type}`, title: titleOf(type), status: code });
  };

/** ルートの外で起きた失敗（バリデーション・ルーティング・想定外の例外）の応答 */
export const problemResponse = (code: number, title: string, extensions: Record<string, unknown> = {}) =>
  status(code, { type: "about:blank", title, status: code, ...extensions });
