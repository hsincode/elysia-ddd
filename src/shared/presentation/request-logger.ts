import { Elysia } from "elysia";
import type { Logger } from "#shared/application/ports";

/** リクエスト ID を振り（x-request-id があれば引き継ぐ）、応答後に 1 行のアクセスログを出す */
export const requestLogger = (logger: Logger) => {
  const startedAt = new WeakMap<Request, number>();
  return new Elysia({ name: "request-logger" })
    .onRequest(({ request, set }) => {
      startedAt.set(request, performance.now());
      set.headers["x-request-id"] = request.headers.get("x-request-id") ?? Bun.randomUUIDv7();
    })
    .onAfterResponse({ as: "global" }, ({ request, set }) => {
      const started = startedAt.get(request);
      logger.info("request", {
        requestId: set.headers["x-request-id"],
        method: request.method,
        path: new URL(request.url).pathname,
        status: set.status,
        ms: started === undefined ? undefined : Math.round(performance.now() - started),
      });
    });
};
