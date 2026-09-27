import type { Clock, IdGenerator, LogFields, Logger } from "#shared/application/ports";

export const systemClock: Clock = { now: () => new Date() };

export const uuidV7: IdGenerator = { next: () => Bun.randomUUIDv7() };

const LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LEVELS)[number];

const serialize = (_key: string, value: unknown) =>
  value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value;

/** 1 行 1 JSON のログ。ログ基盤にそのまま流せる */
export const jsonLogger = (
  minLevel: LogLevel,
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Logger => {
  const min = LEVELS.indexOf(minLevel);
  const at = (level: LogLevel) => (message: string, fields?: LogFields) => {
    if (LEVELS.indexOf(level) < min) return;
    write(JSON.stringify({ time: new Date().toISOString(), level, message, ...fields }, serialize));
  };
  return { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") };
};
