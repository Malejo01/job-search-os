import { ENGLISH_LABEL, MODALITY_LABELS } from "../../../../lib/labels";
import { DETALLE_TEXTOS, llenarTexto } from "../../../../lib/textos-rediseno";

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
};

export type ConditionKey = keyof typeof T.filas;

export type ConditionRow = {
  key: ConditionKey;
  label: string;
  value: string;
  /** El aviso no lo dice: la pantalla lo muestra más apagado. */
  informed: boolean;
};

function clean(text: string | null | undefined): string | null {
  const t = text?.trim().slice(0, 120);
  return t ? t : null;
}

function row(key: ConditionKey, value: string | null): ConditionRow {
  const label = T.filas[key];
  return value === null
    ? { key, label, value: T.noEspecificado, informed: false }
    : { key, label, value, informed: true };
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

  return [
    row("modality", modality),
    row("location", countriesValue(input.countriesAllowed)),
    row("salary", salary),
    row("seniority", seniority),
    row("language", language),
    row("hours", jornada),
    row("contract", clean(input.contractType)),
  ];
}
