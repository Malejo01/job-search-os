import { schema as s } from "@job-search-os/db";
import { needsCareerPrompt, type RoleKey } from "@job-search-os/pipeline";
import { eq, sql } from "drizzle-orm";
import { withUser } from "./db";

/**
 * Escritura del recuadro «¿Cuál es tu carrera?» para cuentas que no la cargaron (R32-01). Solo servidor. La decisión
 * de si hay que pedirla (`needsCareerPrompt`) y la validación (`parseCareerChoice`) son del pipeline. La persona no
 * escribe `career_asked_at` directo (trigger `profiles_news_guard`, rls/0074): el guardado y el «Ahora no» pasan por
 * las funciones `career_prompt_save` y `career_prompt_dismiss`, que solo tocan su propia fila.
 */

/**
 * Un `text[]` de Postgres desde una lista de JS. Interpolar el array en `sql` lo expande como una lista entre
 * paréntesis (`($1, $2)`), que no es un array: cada elemento va como parámetro dentro de `ARRAY[...]`. Sirve
 * también para la lista vacía (`ARRAY[]::text[]`).
 */
export function textArray(items: readonly string[]) {
  return sql`ARRAY[${sql.join(
    items.map((x) => sql`${x}`),
    sql`, `,
  )}]::text[]`;
}

/** La llamada a `career_prompt_save` (rls/0074) con los tres parámetros bien formados. */
export function careerPromptSaveQuery(
  roles: readonly string[],
  other: string | null,
  expected: readonly string[],
) {
  return sql`select public.career_prompt_save(${textArray(roles)}, ${other}::text, ${textArray(expected)}) as ok`;
}

/**
 * Guarda la carrera elegida y deja anotado que ya se pidió. Usa el mismo criterio que el recuadro (sin ninguna clave
 * conocida ni «Otra»), así una cuenta con claves viejas también puede guardar; y solo escribe si la carrera sigue
 * siendo la que se leyó: si la cargó en otra pestaña, no se pisa. `saved` es falso en esos casos.
 */
export async function saveCareerFromPrompt(
  userId: string,
  choice: { roles: RoleKey[]; other: string | null },
): Promise<{ saved: boolean }> {
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .select({ roles: s.profiles.targetRoles, other: s.profiles.careerOther })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1);
    if (!row) return { saved: false };
    const stored = row.roles ?? [];
    if (!needsCareerPrompt({ targetRoles: stored, careerOther: row.other, askedAt: null })) {
      return { saved: false };
    }
    const rows = (await tx.execute(
      careerPromptSaveQuery(choice.roles, choice.other, stored),
    )) as unknown as { ok: boolean }[];
    return { saved: rows[0]?.ok === true };
  });
}

/** «Ahora no» (o ya la tenía): anota que ya se pidió, para no volver a pedirla. No toca la carrera. */
export async function markCareerPromptAsked(userId: string): Promise<boolean> {
  const rows = (await withUser(userId, (tx) =>
    tx.execute(sql`select public.career_prompt_dismiss() as ok`),
  )) as unknown as { ok: boolean }[];
  return rows[0]?.ok === true;
}
