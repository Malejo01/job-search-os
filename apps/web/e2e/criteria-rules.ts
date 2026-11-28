import * as s from "@job-search-os/db/schema";
import { and, eq, sql } from "drizzle-orm";
import criteriaExample from "../../../packages/db/seeds/criteria.example.json";
import type { ownerDb } from "./helpers";

/**
 * Criterios de evaluación válidos para las personas de prueba de los e2e. Con `rules = {}` la evaluación revienta en
 * `decide()` (`rules.years_penalty.from` de `undefined`) y la oferta queda en la cola con `last_error = TypeError`:
 * es un supuesto de datos del e2e, no del código (el alta real arma las reglas con `criteriaFromOnboarding`). Son las
 * mismas reglas de ejemplo que usan el seed y los tests de integración. Datos inventados.
 */
export const E2E_CRITERIA_RULES = criteriaExample as never;

/**
 * Repara una fila activa que quedó con `rules = '{}'` (la dejaron versiones anteriores de los helpers). Solo esa
 * condición: nunca pisa reglas con contenido (los specs 34 y 85 las guardan y las restauran).
 */
export async function repairEmptyCriteria(
  db: ReturnType<typeof ownerDb>["db"],
  userId: string,
): Promise<void> {
  await db
    .update(s.evaluationCriteria)
    .set({ rules: E2E_CRITERIA_RULES })
    .where(
      and(
        eq(s.evaluationCriteria.userId, userId),
        eq(s.evaluationCriteria.active, true),
        sql`${s.evaluationCriteria.rules} = '{}'::jsonb`,
      ),
    );
}
