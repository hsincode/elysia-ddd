import type { DomainEvent } from "#shared/domain/domain-event";

/** イベントを今のトランザクションで outbox に積む。購読側への配送はコミット後に OutboxRelay が行う */
export interface EventPublisher {
  publish(events: readonly DomainEvent[]): Promise<void>;
}

export type EventHandler<E extends DomainEvent = DomainEvent> = (event: E) => Promise<void>;

export type Subscription = { readonly name: string; readonly type: string; readonly handle: EventHandler };

/**
 * イベントの購読を作る。handle は配送のトランザクション（購読ごとのセーブポイント）の中で呼ばれ、
 * 投げるとその購読の書き込みだけが戻されて、あとで配送し直される。
 * name は「どの購読に配送済みか」の記録に使うので、運用に乗せたあとは変えない（変えると過去のイベントがもう一度届く）。
 */
export const subscribe = <E extends DomainEvent>(
  name: string,
  type: E["type"],
  handle: EventHandler<E>,
): Subscription => ({ name, type, handle: handle as EventHandler });
