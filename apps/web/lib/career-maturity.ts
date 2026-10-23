import { createLogger, safeDbError } from "@job-search-os/adapters";
import {
  careerMaturity,
  careerMaturityBadgeEnabled,
  toRoleKey,
  type CareerMaturity,
  type CareerMaturityRules,
  type RoleKey,
} from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { getAppDb } from "./db";

type Row = {
  role: string;
  offers_ok: boolean;
  thumbs_ok: boolean | null;
  active_ok: boolean;
};

/**
 * Reglas por carrera de `career_maturity_stats()` (rls/0009, SECURITY DEFINER): solo sí/no, ya
 * calculado en la base. Caché de 30 minutos sin usuario en la clave: el resultado es el mismo para
 * todas las personas.
 */
const readRules = unstable_cache(
  async (): Promise<[RoleKey, CareerMaturityRules][]> => {
    const rows = (await getAppDb().execute(
      sql`select role, offers_ok, thumbs_ok, active_ok from career_maturity_stats()`,
    )) as unknown as Row[];
    const out: [RoleKey, CareerMaturityRules][] = [];
    for (const r of rows) {
      const role = toRoleKey(r.role);
      if (!role) continue;
      out.push([
        role,
        { offersOk: r.offers_ok === true, thumbsOk: r.thumbs_ok, activeOk: r.active_ok === true },
      ]);
    }
    return out;
  },
  ["career-maturity-v2"],
  { revalidate: 1800, tags: ["career-maturity"] },
);

/**
 * «Madura» o «en pulido» de una carrera (C-13). Null, y la pantalla no muestra el badge, si:
 * - `CAREER_MATURITY_BADGE` no está en «1» (espera la línea de la política de privacidad);
 * - la función todavía no existe en la base (la aplica Mauro con db:migrate) o la consulta falla.
 */
export async function getCareerMaturity(role: RoleKey): Promise<CareerMaturity | null> {
  if (!careerMaturityBadgeEnabled(process.env)) return null;
  try {
    const rules = new Map(await readRules());
    return careerMaturity(rules.get(role));
  } catch (err) {
    createLogger({ task: "career_maturity" }).warn(
      { err: safeDbError(err) },
      "sin reglas de madurez",
    );
    return null;
  }
}
