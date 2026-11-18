import type { Db } from "@job-search-os/db";
import { sql } from "drizzle-orm";
import { CV_RESERVE_LOCK_NAMESPACE } from "./reserve";

/**
 * Compuerta de los tests de integración de las reservas (R13-6), sin `sleep` que adivine tiempos: espera a que
 * Postgres informe que hay un pedido esperando un lock advisory, o a que `pending` termine (señal de que NO
 * esperó el lock). Devuelve `true` solo si `pending` quedó esperando el lock y sigue sin terminar.
 */
export async function waitsOnAdvisoryLock(db: Db, pending: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void pending.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let i = 0; i < 2000 && !settled; i++) {
    const rows = (await db.execute(
      sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted`,
    )) as unknown as { n: number }[];
    if ((rows[0]?.n ?? 0) > 0) return !settled;
    await new Promise((r) => setImmediate(r));
  }
  return false;
}

/**
 * La carrera de R12-16 en forma determinista: una transacción de «otro pedido» tiene el lock de la persona y
 * está midiendo (varias consultas); en el medio, la reserva de este pedido se suelta con `release`. Con la
 * liberación bajo lock, `release` queda esperando y la segunda medición todavía ve la reserva. Sin lock, `release`
 * termina en el acto y la segunda medición ya no la ve.
 */
export async function releaseWhileAnotherMeasures<M>(
  db: Db,
  input: {
    userId: string;
    release: () => Promise<boolean>;
    measure: (tx: Parameters<Parameters<Db["transaction"]>[0]>[0]) => Promise<M>;
  },
): Promise<{ waited: boolean; before: M; after: M; released: boolean }> {
  const inside = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${input.userId}, ${CV_RESERVE_LOCK_NAMESPACE}))`,
    );
    const before = await input.measure(tx);
    const release = input.release();
    const waited = await waitsOnAdvisoryLock(db, release);
    const after = await input.measure(tx);
    return { release, waited, before, after };
  });
  return {
    waited: inside.waited,
    before: inside.before,
    after: inside.after,
    released: await inside.release,
  };
}
