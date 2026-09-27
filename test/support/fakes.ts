import type { EventPublisher } from "#shared/application/events";
import type { Clock, IdGenerator, Logger, UnitOfWork } from "#shared/application/ports";
import type { DomainEvent } from "#shared/domain/domain-event";

/** 手で進める時計 */
export const fixedClock = (iso = "2026-04-01T09:00:00.000Z") => {
  let now = new Date(iso);
  return {
    now: () => new Date(now),
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  } satisfies Clock & { advance(ms: number): void };
};

/** 連番の ID（UUIDv7 の形） */
export const sequentialIds = (): IdGenerator => {
  let n = 0;
  return { next: () => `01900000-0000-7000-8000-${(++n).toString(16).padStart(12, "0")}` };
};

/** トランザクションを張らずにそのまま実行する（DB を使わない単体テスト用） */
export const inlineUnitOfWork: UnitOfWork = { run: (work) => work() };

/** 積まれたイベントを覚えておくだけの EventPublisher */
export const recordingPublisher = () => {
  const published: DomainEvent[] = [];
  return {
    published,
    async publish(events) {
      published.push(...events);
    },
  } satisfies EventPublisher & { published: DomainEvent[] };
};

const ignore = () => {};
export const silentLogger: Logger = { debug: ignore, info: ignore, warn: ignore, error: ignore };
