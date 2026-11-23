import { schema as s } from "@job-search-os/db";
import { and, asc, eq } from "drizzle-orm";
import { withUser } from "@/lib/db";

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

    return {
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
