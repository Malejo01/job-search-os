import { ENGLISH_LABEL, MODALITY_LABELS } from "../../../../lib/labels";
import { DETALLE_TEXTOS, llenarTexto, PANTALLA_TEXTOS } from "../../../../lib/textos-rediseno";

const T = DETALLE_TEXTOS.condiciones;

export type ConditionsInput = {
  salaryMinUsd: number | null;
  salaryMaxUsd: number | null;
  salaryPeriod: string | null;
  modality: string | null;
  englishRequired: string | null;
  yearsRequired: number | null;
  contractType: string | null;
  /** `jobs.countries_allowed`: null = el aviso no lo dice (no se deduce de «remoto»). */
  countriesAllowed?: readonly string[] | null;
  weeklyHours?: number | null;
  /** Las 7 condiciones de la ficha del aviso (R31-04), si existe y está lista. Cada una con su cita. */
  ficha?: FichaCondiciones | null;
  /** Requisitos de la ficha: solo se usan para citar los dos lados cuando el aviso se contradice. */
  fichaRequisitos?: readonly { categoria: string; cita: string }[];
};

/** Estructural: `JobCard["condiciones"]` (packages/pipeline/src/job-card/schema.ts) lo cumple. */
export type FichaCondiciones = {
  modalidad: { valor: string; cita: string } | null;
  desdeDonde: { alcance: string; lugares: readonly string[]; cita: string } | null;
  salario: { texto: string; cita: string } | null;
  experiencia: { texto: string; cita: string } | null;
  ingles: { nivel: string; nivelTexto: string | null; cita: string } | null;
  jornada: { valor: string; cita: string } | null;
  contratacion: { valor: string; cita: string } | null;
};

export type ConditionKey = keyof typeof T.filas;

export type ConditionRow = {
  key: ConditionKey;
  label: string;
  value: string;
  /** El aviso no lo dice: la pantalla lo muestra más apagado. */
  informed: boolean;
  /** Cita literal del aviso: solo cuando el dato viene de la ficha («Así lo dice el aviso»). */
  cita?: string;
};

function clean(text: string | null | undefined): string | null {
  const t = text?.trim().slice(0, 120);
  return t ? t : null;
}

function row(key: ConditionKey, value: string | null, cita?: string): ConditionRow {
  const label = T.filas[key];
  if (value === null) return { key, label, value: T.noEspecificado, informed: false };
  const c = cita?.trim();
  return c ? { key, label, value, informed: true, cita: c } : { key, label, value, informed: true };
}

const V = PANTALLA_TEXTOS.valores;
const lookup = (table: Record<string, string>, k: string): string | null => table[k] ?? null;

/** Valor de una condición de la ficha, o null si el valor no es uno conocido (falla cerrado). */
function fichaValues(
  f: FichaCondiciones,
  requisitos: readonly { categoria: string; cita: string }[] = [],
) {
  const desde = f.desdeDonde;
  let desdeValor: string | null = null;
  if (desde) {
    const base = lookup(V.alcance, desde.alcance);
    const lugares = desde.lugares.map((l) => l.trim()).filter(Boolean);
    desdeValor =
      base === null
        ? null
        : desde.alcance === "paises" || desde.alcance === "ciudad"
          ? lugares.length
            ? `${base} ${lugares.slice(0, 5).join(", ")}`
            : null
          : base;
  }
  const eng = f.ingles;
  const modal = f.modalidad ? (MODALITY_LABELS[f.modalidad.valor] ?? null) : null;
  return {
    modality: f.modalidad && modal ? { v: modal, c: f.modalidad.cita } : null,
    // «Contradictorio»: se muestran las dos citas, la de «cualquier país» y la del lugar exigido
    location:
      desde && desdeValor
        ? {
            v: desdeValor,
            c:
              desde.alcance === "contradictorio"
                ? [
                    desde.cita,
                    ...requisitos
                      .filter((r) => r.categoria === "ubicacion" || r.categoria === "residencia")
                      .map((r) => r.cita),
                  ]
                    .filter((c, i, all) => c.trim() && all.indexOf(c) === i)
                    .join("\n")
                : desde.cita,
          }
        : null,
    salary:
      f.salario && clean(f.salario.texto)
        ? { v: clean(f.salario.texto)!, c: f.salario.cita }
        : null,
    seniority:
      f.experiencia && clean(f.experiencia.texto)
        ? { v: clean(f.experiencia.texto)!, c: f.experiencia.cita }
        : null,
    language: eng
      ? {
          v:
            eng.nivel === "sin_nivel"
              ? `Inglés${eng.nivelTexto ? ` ${clean(eng.nivelTexto)}` : ""}`
              : `Inglés ${ENGLISH_LABEL[eng.nivel] ?? clean(eng.nivelTexto) ?? ""}`.trim(),
          c: eng.cita,
        }
      : null,
    hours:
      f.jornada && lookup(V.jornada, f.jornada.valor)
        ? { v: lookup(V.jornada, f.jornada.valor)!, c: f.jornada.cita }
        : null,
    contract:
      f.contratacion && lookup(V.contratacion, f.contratacion.valor)
        ? { v: lookup(V.contratacion, f.contratacion.valor)!, c: f.contratacion.cita }
        : null,
  } satisfies Record<ConditionKey, { v: string; c: string } | null>;
}

function countriesValue(countries: readonly string[] | null | undefined): string | null {
  const list = (countries ?? []).map((c) => c.trim()).filter(Boolean);
  if (!list.length) return null;
  if (list.includes("*")) return T.todoElMundo;
  const shown = list.slice(0, 5).join(", ");
  return list.length > 5 ? `${shown} y ${list.length - 5} más` : shown;
}

/**
 * «Lo importante para decidir» (R30-08): siempre las 7 filas, en este orden, solo con campos del
 * aviso. Lo que el aviso no dice queda «No especificado»; nada se deduce (remoto no es «desde
 * cualquier país») y nunca se mezcla el perfil. Sin consultas: usa lo que la página ya trae.
 */
export function conditionRows(input: ConditionsInput): ConditionRow[] {
  const { salaryMinUsd: min, salaryMaxUsd: max } = input;
  const range = [min, max].filter(Boolean).join("–");
  const period = clean(input.salaryPeriod);
  const salary = range ? `USD ${range}${period ? ` ${period}` : ""}` : null;

  const modality =
    input.modality && input.modality !== "desconocida"
      ? (MODALITY_LABELS[input.modality] ?? clean(input.modality))
      : null;

  const eng = input.englishRequired;
  const language =
    eng === null || eng === "no_menciona"
      ? null
      : eng === "no"
        ? T.inglesNoLoPide
        : `Inglés ${ENGLISH_LABEL[eng] ?? clean(eng) ?? ""}`.trim();

  const years = input.yearsRequired;
  const seniority =
    years === null || !Number.isFinite(years)
      ? null
      : `${years} ${years === 1 ? "año" : "años"} de experiencia`;

  const hours = input.weeklyHours;
  const jornada =
    typeof hours === "number" && Number.isFinite(hours) && hours > 0
      ? llenarTexto(T.horasSemanales, { n: hours })
      : null;

  // Con ficha lista, cada fila usa lo que la ficha citó del aviso; si la ficha no trae esa
  // condición, queda lo que el aviso ya traía en sus columnas (también es del aviso, sin cita).
  const f = input.ficha ? fichaValues(input.ficha, input.fichaRequisitos) : null;
  const pick = (key: ConditionKey, fallback: string | null): ConditionRow =>
    f?.[key] ? row(key, f[key].v, f[key].c) : row(key, fallback);
  return [
    pick("modality", modality),
    pick("location", countriesValue(input.countriesAllowed)),
    pick("salary", salary),
    pick("seniority", seniority),
    pick("language", language),
    pick("hours", jornada),
    pick("contract", clean(input.contractType)),
  ];
}
