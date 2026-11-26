import * as s from "@job-search-os/db/schema";
import { eq } from "drizzle-orm";
import { createEvaluation, createJob, ownerDb } from "./helpers";

/** Ayudas de los flujos 348 a 357 (listado de R30). Datos inventados, siempre con un tag en el título. */

type ChecklistRow = {
  id: string;
  kind?: "estructurado" | "skill" | "texto";
  nivel?: "must" | "deseable";
  status: "cumple" | "no_cumple" | "no_se_sabe";
  pide: string;
  tenes: string | null;
  bloquea?: boolean;
};

/** Una oferta evaluada de la persona de prueba, con la tabla de requisitos que se pida. */
export async function createEvaluatedJob(options: {
  title: string;
  score: number;
  items?: ChecklistRow[];
  status?: "evaluada" | "aplicada";
  salary?: { min: number; max: number; period: string };
  modality?: "remoto" | "hibrido" | "presencial";
  locationRaw?: string;
}): Promise<string> {
  const id = await createJob({
    title: options.title,
    status: options.status ?? "evaluada",
    jdText: "JD ficticia.",
  });
  await createEvaluation(id, { score: options.score, accion: "guardar" });
  const { db, close } = ownerDb();
  try {
    if (options.items) {
      const items = options.items.map((i) => ({
        kind: "estructurado",
        nivel: "must",
        evidencia: null,
        fuente: { pide: "fuente", tenes: "perfil" },
        bloquea: false,
        ...i,
      }));
      await db
        .update(s.evaluations)
        .set({ decision: { checklist: { items } } })
        .where(eq(s.evaluations.jobId, id));
    }
    const patch: Partial<typeof s.jobs.$inferInsert> = {};
    if (options.salary) {
      patch.salaryMinUsd = options.salary.min;
      patch.salaryMaxUsd = options.salary.max;
      patch.salaryPeriod = options.salary.period;
    }
    if (options.modality) patch.modality = options.modality;
    if (options.locationRaw) patch.locationRaw = options.locationRaw;
    if (Object.keys(patch).length > 0) await db.update(s.jobs).set(patch).where(eq(s.jobs.id, id));
    return id;
  } finally {
    await close();
  }
}

/** Marca «Guardada» de una oferta, leída de la base (null = no guardada). */
export async function savedAtOf(jobId: string): Promise<Date | null> {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .select({ savedAt: s.jobs.savedAt })
      .from(s.jobs)
      .where(eq(s.jobs.id, jobId));
    return row?.savedAt ?? null;
  } finally {
    await close();
  }
}
