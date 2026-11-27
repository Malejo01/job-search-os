import { schema as s } from "@job-search-os/db";
import { summarizeRequirements, type OfferRequirementInput } from "@job-search-os/pipeline";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withUser } from "@/lib/db";

const checklistItemSchema = z.object({
  id: z.string().max(120),
  kind: z.enum(["estructurado", "skill", "texto"]),
  nivel: z.enum(["must", "deseable"]),
  pide: z.string().max(400),
  evidencia: z.string().nullable().optional(),
  tenes: z.string().nullable(),
  status: z.enum(["cumple", "no_cumple", "no_se_sabe"]),
  fuente: z.object({ pide: z.enum(["fuente", "modelo"]), tenes: z.string().nullable() }),
  bloquea: z.boolean(),
});

/** Filas de la tabla de requisitos guardada (entrada no confiable: se valida; lo que no cumple el esquema se ignora). */
function parseRequirementRows(raw: unknown): OfferRequirementInput[] {
  if (!Array.isArray(raw)) return [];
  const items = raw.slice(0, 60).flatMap((x) => {
    const r = checklistItemSchema.safeParse(x);
    return r.success ? [r.data] : [];
  });
  return summarizeRequirements({ items: items as never }).rows.map((r) => ({
    code: r.code,
    nivel: r.nivel,
    state: r.state,
    pide: r.item.pide,
  }));
}

export type PostularData = {
  id: string;
  title: string;
  company: string;
  /** Publicación original: canonical_url o, si no hay, la URL de alguna fuente. */
  url: string | null;
  /** Respuestas del formulario ya aprobadas para esta oferta (application_answers). */
  answers: { question: string; answer: string }[];
  /** Carta o nota de la postulación, si la persona ya la guardó. */
  coverNote: string | null;
  /** Skills que pide el aviso, con sus alias de la taxonomía. */
  offerSkills: { name: string; aliases: string[]; isMust: boolean }[];
  /** Filas de la tabla de requisitos (R34-02); vacío si la oferta todavía no se evaluó. */
  requirements: OfferRequirementInput[];
};

/**
 * Lo que ya existe de una oferta para preparar la postulación. Solo lectura, en una transacción con
 * RLS (`withUser`) y filtrando por la persona. No llama a ningún modelo ni guarda nada.
 */
export async function getPostularData(userId: string, jobId: string): Promise<PostularData | null> {
  return withUser(userId, async (tx) => {
    const [job] = await tx
      .select({
        id: s.jobs.id,
        title: s.jobs.title,
        company: s.jobs.companyRaw,
        canonicalUrl: s.jobs.canonicalUrl,
      })
      .from(s.jobs)
      .where(and(eq(s.jobs.id, jobId), eq(s.jobs.userId, userId)))
      .limit(1);
    if (!job) return null;

    const sources = job.canonicalUrl
      ? []
      : await tx
          .select({ url: s.jobSources.url })
          .from(s.jobSources)
          .where(eq(s.jobSources.jobId, jobId))
          .orderBy(asc(s.jobSources.seenAt))
          .limit(10);
    const answers = await tx
      .select({ question: s.applicationAnswers.question, answer: s.applicationAnswers.answer })
      .from(s.applicationAnswers)
      .where(and(eq(s.applicationAnswers.userId, userId), eq(s.applicationAnswers.jobId, jobId)))
      .orderBy(asc(s.applicationAnswers.position));
    const [app] = await tx
      .select({ coverNote: s.applications.coverNote })
      .from(s.applications)
      .where(and(eq(s.applications.userId, userId), eq(s.applications.jobId, jobId)))
      .limit(1);

    // Skills que pide el aviso (ya extraídas en la ingesta): una consulta chica, tope 60
    const offerSkills = await tx
      .select({ name: s.skills.name, aliases: s.skills.aliases, isMust: s.jobSkills.isMust })
      .from(s.jobSkills)
      .innerJoin(s.skills, eq(s.skills.id, s.jobSkills.skillId))
      .where(eq(s.jobSkills.jobId, jobId))
      .limit(60);

    // R34-02: filas de la tabla de requisitos de la última evaluación (si hay), solo para «Revisar mi CV»
    const [lastEval] = await tx
      .select({ checklist: sql<unknown>`${s.evaluations.decision} -> 'checklist' -> 'items'` })
      .from(s.evaluations)
      .where(and(eq(s.evaluations.userId, userId), eq(s.evaluations.jobId, jobId)))
      .orderBy(desc(s.evaluations.createdAt))
      .limit(1);

    return {
      requirements: parseRequirementRows(lastEval?.checklist),
      offerSkills,
      id: job.id,
      title: job.title,
      company: job.company,
      url: job.canonicalUrl ?? sources.find((x) => x.url)?.url ?? null,
      answers,
      coverNote: app?.coverNote?.trim() ? app.coverNote : null,
    };
  });
}
