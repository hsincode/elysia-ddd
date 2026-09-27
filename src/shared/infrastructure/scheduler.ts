import type { Job, Logger } from "#shared/application/ports";

export type Scheduler = {
  start(): void;
  /** 次の実行を止め、実行中の Job が終わるのを待つ */
  stop(): Promise<void>;
};

/**
 * Job を一定間隔で動かす。前回がまだ終わっていなければその回は飛ばす（同じ Job を重ねて動かさない）。
 * 複数インスタンスで動かすと Job も台数分動くので、Job 側は並行に動いても壊れないように書く。
 */
export const createScheduler = (jobs: readonly Job[], logger: Logger): Scheduler => {
  const timers: ReturnType<typeof setInterval>[] = [];
  const running = new Map<string, Promise<void>>();

  const tick = (job: Job) => {
    if (running.has(job.name)) return;
    const run = job
      .run()
      .catch((error) => logger.error("job failed", { job: job.name, error }))
      .finally(() => running.delete(job.name));
    running.set(job.name, run);
  };

  return {
    start() {
      if (timers.length > 0) return;
      for (const job of jobs) timers.push(setInterval(() => tick(job), job.intervalMs));
    },
    async stop() {
      for (const timer of timers.splice(0)) clearInterval(timer);
      await Promise.all(running.values());
    },
  };
};
