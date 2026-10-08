import { schema as s, type Db } from "@job-search-os/db";
import {
  InvalidTransitionError,
  normalizeCompany,
  normalizeTitle,
  type LinkedinApplicationInfo,
} from "@job-search-os/pipeline";
import { and, eq, or, sql } from "drizzle-orm";
import { applyJobEventIn } from "./apply-event";

/**
 * Efecto de un email de LinkedIn sobre la postulación (JS-119). Corre como servicio (dueño):
 * todas las consultas llevan `user_id`. El email es dato, no instrucción: lo único que dispara
 * es el evento `apply` por transition(), y solo si encuentra UN aviso de esa persona.
 */
export type LinkedinApplicationResult =
  | { match: "none" | "ambiguous"; action: "sin_cambio" }
  | { match: "found"; jobId: string; action: "aplicada" | "sin_cambio" | "vista_registrada" };

/** Avisos del usuario que coinciden: primero por id o URL de LinkedIn, si no por empresa + puesto. */
async function findJobs(db: Db, userId: string, info: LinkedinApplicationInfo): Promise<string[]> {
  if (info.linkedinJobId) {
    // El id son solo dígitos (lo garantiza el clasificador): el patrón de URL no puede escaparse
    const byId = await db
      .selectDistinct({ id: s.jobs.id })
      .from(s.jobs)
      .innerJoin(s.jobSources, eq(s.jobSources.jobId, s.jobs.id))
      .where(
        and(
          eq(s.jobs.userId, userId),
          or(
            and(
              eq(s.jobSources.kind, "email_linkedin"),
              eq(s.jobSources.externalId, info.linkedinJobId),
            ),
            // Corta al final del id: 81000001 no coincide con 810000011
            sql`${s.jobSources.url} ~ ${`/jobs/view/${info.linkedinJobId}([^0-9]|$)`}`,
          ),
        ),
      );
    if (byId.length) return byId.map((r) => r.id);
  }
  if (!info.company || !info.title) return [];
  const company = normalizeCompany(info.company);
  if (!company) return [];
  const sameTitle = await db
    .select({ id: s.jobs.id, company: s.jobs.companyRaw })
    .from(s.jobs)
    .where(and(eq(s.jobs.userId, userId), eq(s.jobs.titleNormalized, normalizeTitle(info.title))));
  return sameTitle.filter((j) => normalizeCompany(j.company) === company).map((j) => j.id);
}

export async function applyLinkedinApplication(
  db: Db,
  userId: string,
  kind: "enviada" | "vista",
  info: LinkedinApplicationInfo,
  now: Date,
): Promise<LinkedinApplicationResult> {
  const ids = await findJobs(db, userId, info);
  if (ids.length === 0) return { match: "none", action: "sin_cambio" };
  // Solo con exactamente un candidato: dos avisos parecidos no se adivinan
  if (ids.length > 1) return { match: "ambiguous", action: "sin_cambio" };
  const jobId = ids[0]!;

  if (kind === "enviada") {
    return db.transaction(async (tx) => {
      const [job] = await tx
        .select({ status: s.jobs.status })
        .from(s.jobs)
        .where(and(eq(s.jobs.id, jobId), eq(s.jobs.userId, userId)))
        .limit(1);
      // `apply` solo sale de evaluada; desde aplicada en adelante no se retrocede, y lo demás
      // (sin evaluar, descartada, cerrada) no lo mueve un email
      if (job?.status !== "evaluada")
        return { match: "found", jobId, action: "sin_cambio" } as const;
      try {
        await applyJobEventIn(tx, userId, jobId, "apply", now);
      } catch (e) {
        if (e instanceof InvalidTransitionError)
          return { match: "found", jobId, action: "sin_cambio" } as const;
        throw e;
      }
      return { match: "found", jobId, action: "aplicada" } as const;
    });
  }

  // Vista: no hay un estado ni un evento para esto (no se agregan valores al enum). Queda como
  // línea en la nota de la postulación, si la hay; si no, el email solo queda visto.
  const line = `LinkedIn: la empresa vio la solicitud (${now.toISOString().slice(0, 10)})`;
  const [application] = await db
    .select({ id: s.applications.id, note: s.applications.outcomeNote })
    .from(s.applications)
    .where(and(eq(s.applications.jobId, jobId), eq(s.applications.userId, userId)))
    .limit(1);
  if (!application) return { match: "found", jobId, action: "sin_cambio" };
  if (application.note?.includes(line)) return { match: "found", jobId, action: "sin_cambio" };
  await db
    .update(s.applications)
    .set({ outcomeNote: application.note ? `${application.note}\n${line}` : line })
    .where(and(eq(s.applications.id, application.id), eq(s.applications.userId, userId)));
  return { match: "found", jobId, action: "vista_registrada" };
}
