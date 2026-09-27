import { and, eq } from "drizzle-orm";
import { ConcurrencyError } from "#shared/application/errors";
import { unwrap } from "#shared/domain/result";
import type { CurrentDb } from "#shared/infrastructure/transaction";
import type { ReservationRepository } from "../domain/repositories";
import { OrderId, Reservation } from "../domain/reservation";
import { ProductId, Quantity } from "../domain/stock-item";
import { reservationLines, reservations } from "./schema";

export const drizzleReservationRepository = (db: CurrentDb): ReservationRepository => ({
  async find(orderId) {
    const [row] = await db().select().from(reservations).where(eq(reservations.orderId, orderId));
    if (!row) return null;
    const lines = await db().select().from(reservationLines).where(eq(reservationLines.orderId, orderId));
    return Reservation.reconstitute({
      orderId: OrderId(row.orderId),
      status: row.status,
      lines: lines.map((line) => ({
        productId: ProductId(line.productId),
        quantity: unwrap(Quantity.of(line.quantity)),
      })),
      version: row.version,
    });
  },

  async save(reservation) {
    const { orderId, status } = reservation;
    if (reservation.version === 0) {
      const inserted = await db()
        .insert(reservations)
        .values({ orderId, status, version: 1 })
        .onConflictDoNothing()
        .returning({ orderId: reservations.orderId });
      if (inserted.length === 0) {
        throw new ConcurrencyError(`reservation for order ${orderId} was created concurrently`);
      }
      if (reservation.lines.length > 0) {
        await db()
          .insert(reservationLines)
          .values(reservation.lines.map((line) => ({ orderId, ...line })));
      }
      return;
    }
    // 引当の行は作ったあと変わらないので、更新するのは状態だけ
    const updated = await db()
      .update(reservations)
      .set({ status, version: reservation.version + 1 })
      .where(and(eq(reservations.orderId, orderId), eq(reservations.version, reservation.version)))
      .returning({ orderId: reservations.orderId });
    if (updated.length === 0) throw new ConcurrencyError(`reservation for order ${orderId} was modified concurrently`);
  },
});
