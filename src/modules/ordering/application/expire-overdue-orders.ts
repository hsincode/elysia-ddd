import { ConcurrencyError } from "#shared/application/errors";
import type { EventPublisher } from "#shared/application/events";
import type { Clock, Logger, UnitOfWork } from "#shared/application/ports";
import { ok } from "#shared/domain/result";
import { CONFIRMATION_DEADLINE_MS } from "../domain/order";
import type { OrderRepository } from "../domain/order-repository";

const BATCH_SIZE = 100;

/**
 * 在庫の確保を待ったまま期限を過ぎた注文を取り消す（定期実行）。
 * 在庫の知らせがデッドレターに落ちるなどして、注文が確保待ちのまま残り続けるのを防ぐ。
 * 1 件ずつ別のトランザクションで処理し、同時に確定・取消された注文（楽観ロックの衝突）は飛ばす。
 */
export const expireOverdueOrders =
  (deps: { orders: OrderRepository; events: EventPublisher; unitOfWork: UnitOfWork; clock: Clock; logger: Logger }) =>
  async (): Promise<number> => {
    const now = deps.clock.now();
    const cutoff = new Date(now.getTime() - CONFIRMATION_DEADLINE_MS);
    const candidates = await deps.orders.findUnconfirmedPlacedBy(cutoff, BATCH_SIZE);
    let expired = 0;
    for (const orderId of candidates) {
      try {
        const result = await deps.unitOfWork.run(async () => {
          const order = await deps.orders.findById(orderId);
          // 候補を読んだあとに確定・取消されていれば、ドメインが断る（遷移できない・期限前）
          const cancelled = order?.expire(now);
          if (!cancelled?.ok) return ok(false);
          await deps.orders.save(cancelled.value.order);
          await deps.events.publish([cancelled.value.event]);
          return ok(true);
        });
        if (result.value) expired++;
      } catch (error) {
        if (!(error instanceof ConcurrencyError)) throw error;
        deps.logger.info("order changed while expiring; skipped", { orderId });
      }
    }
    return expired;
  };
