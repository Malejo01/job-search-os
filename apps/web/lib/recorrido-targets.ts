import { schema as s } from "@job-search-os/db";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { withUser } from "./db";
import { NO_TARGETS, type RecorridoTargets } from "./recorrido";

const DISCARDED = ["descartada", "descartada_prefiltro", "rechazo_automatico", "cerrada"] as const;

/**
 * A qué oferta y a qué simulación lleva «Abrir» en `/recorrido` (R26-03): las más recientes de quien revisa,
 * leídas con su sesión (RLS: solo lo suyo). Si la consulta falla, no hay destinos y «Abrir» cae en la lista:
 * la pantalla nunca se rompe por esto. Solo ids, nada de títulos.
 */
export async function loadRecorridoTargets(userId: string): Promise<RecorridoTargets> {
  try {
    return await withUser(userId, async (tx) => {
      const [job] = await tx
        .select({ id: s.jobs.id })
        .from(s.jobs)
        .where(and(eq(s.jobs.userId, userId), notInArray(s.jobs.status, [...DISCARDED])))
        .orderBy(desc(s.jobs.firstSeenAt))
        .limit(1);
      const sessions = await tx
        .select({ id: s.interviewSessions.id, status: s.interviewSessions.status })
        .from(s.interviewSessions)
        .where(eq(s.interviewSessions.userId, userId))
        .orderBy(desc(s.interviewSessions.createdAt))
        .limit(10);
      return {
        jobId: job?.id ?? null,
        interviewActiveId: sessions.find((x) => x.status === "en_curso")?.id ?? null,
        interviewDoneId: sessions.find((x) => x.status === "terminada")?.id ?? null,
      };
    });
  } catch {
    return NO_TARGETS;
  }
}
