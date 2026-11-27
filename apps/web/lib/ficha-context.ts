import { schema as s } from "@job-search-os/db";
import type { CurrentProfileFacts, RequirementAnswer } from "@job-search-os/pipeline";
import { eq } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { loadRequirementAnswers, requirementAnswersAllowedFor } from "@/lib/requirement-answers";

export type PerfilActual = { englishCefr: string | null; yearsTotal: number | null };

/** Inglés y años del perfil de hoy (una fila). Sin modelo. */
export async function loadPerfilActual(userId: string): Promise<PerfilActual> {
  const [row] = await withUser(userId, (tx) =>
    tx
      .select({ englishCefr: s.profiles.englishCefr, yearsTotal: s.profiles.yearsTotal })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId)),
  );
  return { englishCefr: row?.englishCefr ?? null, yearsTotal: row?.yearsTotal ?? null };
}

export type FichaContext = {
  answers?: ReadonlyMap<string, RequirementAnswer>;
  facts?: CurrentProfileFacts;
};

/**
 * Lo que se superpone a las tablas guardadas para que la tarjeta y el detalle digan lo mismo (R31-07):
 * respuestas de un toque y el inglés y los años de hoy. Con `JOB_CARD` apagada devuelve `{}` sin
 * consultar nada (la R30 tal cual). Con ella, 2 consultas por pantalla, nunca por oferta.
 */
export async function loadFichaContext(userId: string): Promise<FichaContext> {
  if (!(await requirementAnswersAllowedFor(userId))) return {};
  const [answers, facts] = await Promise.all([
    loadRequirementAnswers(userId),
    loadPerfilActual(userId),
  ]);
  return { answers, facts };
}
