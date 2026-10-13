import { createLogger, explainEmptyRoles, safeDbError } from "@job-search-os/adapters";
import type { RoleGapSummary } from "@job-search-os/pipeline";
import { withUser } from "./db";

/**
 * Puestos elegidos sin ofertas y el porqué (ronda 46). Corre con el rol de la app y `app.user_id`
 * fijado: las policies de RLS dejan solo lo de esa persona y `public_jobs` es legible. Sin modelo
 * ni red. Si algo falla devuelve `[]`: es una ayuda y nunca rompe la página.
 */
export async function getRoleGaps(userId: string): Promise<RoleGapSummary[]> {
  try {
    return await withUser(userId, (tx) => explainEmptyRoles(tx, userId));
  } catch (e) {
    createLogger({ user_id: userId, task: "role_gaps" }).warn(
      { err: safeDbError(e) },
      "no se pudo explicar los puestos sin ofertas",
    );
    return [];
  }
}
