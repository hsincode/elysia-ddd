import { openapi } from "@elysiajs/openapi";
import { Elysia } from "elysia";
import type { Logger } from "#shared/application/ports";
import { errorHandler } from "./error-handler";
import { requestLogger } from "./request-logger";

/** 全ルート共通の土台。各コンテキストのルートはこれに .use() で積む */
export const httpApp = (logger: Logger, options: { maxBodyBytes: number }) =>
  // 大きすぎる本文はパースする前に 413 で断る
  new Elysia({ serve: { maxRequestBodySize: options.maxBodyBytes } })
    .use(requestLogger(logger))
    .use(errorHandler(logger))
    .use(
      openapi({
        documentation: {
          info: { title: "elysia-ddd", version: "0.2.0", description: "Bun + Elysia の DDD テンプレート" },
        },
      }),
    )
    .get("/health", () => ({ status: "ok" as const }), { detail: { tags: ["system"] } });
