import { z } from "zod";

/**
 * Cupos de fundador por carrera (C-13b). Puro: valida lo que devuelve `admin_founder_counts()`
 * (rls/0012) y arma las filas de la pantalla del admin. Las filas con menos de k personas llegan con
 * `people` null (k-anonimato en la base) y se muestran como «<3», nunca como 0. El cupo todavía no
 * está decidido (`FOUNDER_SEATS_PER_CAREER` es null): sin cupo, solo se muestra cuántas personas hay.
 */

/** Fila especial del total general. No es una carrera: las claves válidas nunca se llaman así. */
export const FOUNDER_TOTAL_KEY = "total";
/** Personas con plan fundador cuya carrera no es una clave válida (o no tienen). */
export const FOUNDER_NO_CAREER_KEY = "sin_carrera";

/** Igual que en `admin_beta_metrics`: el umbral vive en la base y acá solo se usa para el rótulo. */
const FOUNDER_K = 3;

export const FounderCountsSchema = z.array(
  z.object({
    role: z.string().regex(/^[a-z0-9_]{1,40}$/),
    people: z.number().int().nonnegative().nullable(),
  }),
);

export type FounderCountRow = z.infer<typeof FounderCountsSchema>[number];

export type FounderSeatRow = {
  /** Clave de la carrera, `sin_carrera` o `total`. */
  key: string;
  label: string;
  /** «<3», «5» o «5 de 10» (el «de N» solo con cupo y solo en las carreras). */
  value: string;
};

/** Falla cerrado: si la forma no es la esperada, null (la pantalla dice que no hay datos). */
export function parseFounderCounts(raw: unknown): FounderCountRow[] | null {
  const parsed = FounderCountsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function rank(key: string): number {
  if (key === FOUNDER_TOTAL_KEY) return 2;
  if (key === FOUNDER_NO_CAREER_KEY) return 1;
  return 0;
}

/**
 * Filas para la tabla: carreras por cantidad de personas (las enmascaradas al final de las
 * carreras), después «sin carrera» y el total. `labelOf` pone el nombre de la carrera (null = usar la
 * clave). Un cupo que no sea un entero positivo se ignora.
 */
export function founderSeatRows(
  rows: readonly FounderCountRow[],
  seats: number | null,
  labelOf: (key: string) => string | null = () => null,
): FounderSeatRow[] {
  const cap = seats !== null && Number.isInteger(seats) && seats > 0 ? seats : null;
  const label = (key: string) => {
    if (key === FOUNDER_TOTAL_KEY) return "Total";
    if (key === FOUNDER_NO_CAREER_KEY) return "Sin carrera";
    return labelOf(key) ?? key.replaceAll("_", " ");
  };
  return [...rows]
    .sort(
      (a, b) =>
        rank(a.role) - rank(b.role) ||
        (b.people ?? -1) - (a.people ?? -1) ||
        a.role.localeCompare(b.role),
    )
    .map((r) => {
      const isCareer = rank(r.role) === 0;
      const value =
        r.people === null
          ? `<${FOUNDER_K}`
          : isCareer && cap !== null
            ? `${r.people} de ${cap}`
            : String(r.people);
      return { key: r.role, label: label(r.role), value };
    });
}
