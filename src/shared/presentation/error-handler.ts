import { Elysia } from "elysia";
import { ConcurrencyError } from "#shared/application/errors";
import type { Logger } from "#shared/application/ports";
import { problemResponse } from "./problem";

/** ルートが Result として返さなかった失敗を Problem Details にそろえる（全ルートに効くよう global） */
export const errorHandler = (logger: Logger) =>
  new Elysia({ name: "error-handler" }).onError({ as: "global" }, ({ code, error, request }) => {
    switch (code) {
      case "VALIDATION":
        // 応答がスキーマに合わないのはサーバー側のバグ。クライアントの入力の誤り（400）とは分ける
        if (error.type === "response") {
          logger.error("response does not match its schema", { method: request.method, url: request.url, error });
          return problemResponse(500, "Internal server error");
        }
        return problemResponse(400, "Invalid request", {
          errors: error.all.map((issue) => ({ path: issue.path, message: issue.summary ?? issue.message })),
        });
      case "PARSE":
        return problemResponse(400, "Malformed request body");
      case "NOT_FOUND":
        return problemResponse(404, "Not found");
    }
    // ルートが status() で投げた応答はそのまま返す
    if (typeof code === "number") return;
    if (error instanceof ConcurrencyError) {
      return problemResponse(409, "Concurrent modification", { detail: error.message });
    }
    logger.error("unhandled error", { method: request.method, url: request.url, error });
    return problemResponse(500, "Internal server error");
  });
