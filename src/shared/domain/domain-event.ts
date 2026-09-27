/**
 * ドメインで起きた事実。outbox に JSON で保存され、コミット後に他のモジュールへ配送される。
 * そのため payload には JSON にそのまま載る値（文字列・数値・配列・プレーンなオブジェクト）だけを入れる。
 */
export type DomainEvent<Type extends string = string, Payload = unknown> = Readonly<{
  type: Type;
  aggregateId: string;
  occurredAt: Date;
  payload: Payload;
}>;
