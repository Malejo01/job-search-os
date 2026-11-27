import { schema as s, type Db } from "@job-search-os/db";
import { hasEnoughJobText, jobCardHash } from "@job-search-os/pipeline";
import { and, eq, isNull } from "drizzle-orm";

/**
 * Completa `jobs.jd_hash` de una oferta que lo tiene nulo (las ofertas anteriores a la columna, R31). La RLS de
 * `job_cards` une la ficha con la oferta por ese hash: sin él, la ficha generada no se ve y la pantalla quedaría en
 * «preparando». Es el mismo hash que calcula la ingesta (`jobCardHash` = `jdHash`). Solo toca el hash y solo si
 * está nulo; no cambia `updated_at`. `db` puede ser la transacción de la persona (`withUser`, RLS) o el servicio con
 * el dueño filtrado por quien llama. Devuelve el hash, o `null` si no hay texto suficiente.
 */
export async function fillMissingJdHash(
  db: Pick<Db, "update">,
  jobId: string,
  jdText: string | null,
): Promise<string | null> {
  if (!hasEnoughJobText(jdText)) return null;
  const hash = jobCardHash(jdText ?? "");
  await db
    .update(s.jobs)
    .set({ jdHash: hash })
    .where(and(eq(s.jobs.id, jobId), isNull(s.jobs.jdHash)));
  return hash;
}
