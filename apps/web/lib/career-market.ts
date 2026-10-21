import { readCareerMarketInput, readCareerSalaryJobs } from "@job-search-os/adapters";
import {
  ROLE_KEYS,
  buildCareerMarket,
  buildCareerSalary,
  toRoleKey,
  type CareerMarket,
  type RoleKey,
} from "@job-search-os/pipeline";
import { unstable_cache } from "next/cache";
import { assertAppRole, getAppDb } from "./db";
import { ROLE_SKILLS } from "./skill-levels";

/**
 * Mercado por carrera (ronda 58): lo que piden las ofertas públicas del pool para una carrera,
 * con skills, inglés, seniority, sueldos y volumen. Cálculo puro en el pipeline; acá solo la lectura
 * y el caché.
 */

/**
 * `?carrera=`: solo claves de `ROLE_KEYS` (la anterior `producto_proyectos` se traduce con
 * `toRoleKey`). Con varios valores, el primero; lo demás es null.
 */
export function parseCareer(param: string | string[] | undefined): RoleKey | null {
  return toRoleKey(Array.isArray(param) ? param[0] : param);
}

/** Etiqueta de la carrera, la del seed de roles; nunca la clave interna. */
export function careerLabel(role: RoleKey): string {
  return ROLE_SKILLS[role].label;
}

/**
 * Caché de 30 minutos por carrera. La clave y los tags NO llevan usuario a propósito: el resultado
 * sale solo de `public_jobs`, `public_job_skills` y `skills` (lectura abierta, sin datos de nadie),
 * así que es idéntico para todas las personas y compartirlo es seguro. El valor es JSON plano
 * (fechas en ISO) porque el Data Cache lo serializa.
 */
export function getCareerMarket(role: RoleKey): Promise<CareerMarket> {
  return unstable_cache(
    async () => {
      await assertAppRole();
      // Sin `withUser`: no se fija `app.user_id`; las policies de estas tablas son `USING (true)`.
      const input = await getAppDb().transaction(
        (tx) => readCareerMarketInput(tx, role, new Date()),
        { accessMode: "read only" },
      );
      return buildCareerMarket(input);
    },
    // v2: el sueldo pasó de una cifra única a { latam, international }; v3: suma writtenInSpanish
    ["career-market", "v3", role],
    { revalidate: 1800, tags: ["career-market", `career-market:${role}`] },
  )();
}

/**
 * Sueldos de todas las carreras para el paso 1 del onboarding: una sola lectura del pool (30 días) y
 * un solo caché de 30 minutos, en vez de una consulta por carrera y por visita. Misma razón que arriba para no
 * llevar usuario en la clave: sale solo de `public_jobs`.
 */
export function getCareerSalaries(): Promise<Record<RoleKey, CareerMarket["salary"]>> {
  return unstable_cache(
    async () => {
      await assertAppRole();
      const rows = await getAppDb().transaction((tx) => readCareerSalaryJobs(tx, new Date()), {
        accessMode: "read only",
      });
      const out = {} as Record<RoleKey, CareerMarket["salary"]>;
      for (const role of ROLE_KEYS) {
        out[role] = buildCareerSalary(
          rows.filter((r) => r.roleHints.includes(role)).map((r) => r.job),
        );
      }
      return out;
    },
    ["career-salaries", "v2"],
    { revalidate: 1800, tags: ["career-market"] },
  )();
}
