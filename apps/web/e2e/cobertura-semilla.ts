import * as s from "@job-search-os/db/schema";
import { like } from "drizzle-orm";
import { ownerDb } from "./helpers";

/**
 * Siembra del pool para los flujos 404 a 407 (R32-02, panel de cobertura). Todo inventado: empresas y títulos
 * ficticios, con un prefijo propio por flujo para limpiar solo lo que se creó. Cada flujo usa una carrera
 * distinta de la beta, así los números de uno no mueven los del otro.
 */
const DAY = 24 * 60 * 60 * 1000;

export type SemillaOferta = {
  /** Qué dice `countries_allowed`; null = la fuente no lo dice. */
  paises: string[] | null;
  /** Hace cuántos días la vio una fuente por última vez (vigente = hasta 7). */
  vistaHace: number;
  junior?: boolean;
  lugar?: string | null;
  idioma?: "es" | "en";
  fuente?: "wwr" | "remoteok";
};

export async function limpiarSemilla(prefix: string): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.publicJobs).where(like(s.publicJobs.externalId, `${prefix}%`));
  } finally {
    await close();
  }
}

export async function sembrarOfertas(
  prefix: string,
  role: string,
  ofertas: readonly SemillaOferta[],
): Promise<void> {
  const { db, close } = ownerDb();
  try {
    const now = Date.now();
    await db.insert(s.publicJobs).values(
      ofertas.map((o, i) => {
        const n = i + 1;
        return {
          sourceKind: o.fuente ?? ("wwr" as const),
          externalId: `${prefix}${n}`,
          sourceName: "Fuente ficticia",
          sourceUrl: `https://example.com/jobs/${prefix}${n}`,
          title: `Puesto ficticio ${n}`,
          titleNormalized: `puesto ficticio ${n}`,
          companyRaw: `Empresa Ficticia ${n}`,
          companyNormalized: `empresa ficticia ${n}`,
          roleHints: [role],
          countriesAllowed: o.paises,
          locationRaw: o.lugar ?? null,
          seniority: o.junior ? "Junior" : null,
          jdLanguage: o.idioma ?? null,
          firstSeenAt: new Date(now - 40 * DAY),
          lastSeenAt: new Date(now - o.vistaHace * DAY),
        };
      }),
    );
  } finally {
    await close();
  }
}
