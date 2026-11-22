import { ENGLISH_LABEL, MODALITY_LABELS } from "../../../../lib/labels";
import { NOT_INFORMED_LABEL } from "../../../../lib/textos-rediseno";

export type ConditionsInput = {
  salaryMinUsd: number | null;
  salaryMaxUsd: number | null;
  salaryPeriod: string | null;
  modality: string | null;
  englishRequired: string | null;
  yearsRequired: number | null;
  contractType: string | null;
};

export type ConditionRow = {
  key: "salary" | "modality" | "language" | "seniority" | "contract";
  label: string;
  value: string;
  /** El aviso no lo dice: la pantalla lo muestra más apagado. */
  informed: boolean;
};

function clean(text: string | null): string | null {
  const t = text?.trim().slice(0, 120);
  return t ? t : null;
}

function row(key: ConditionRow["key"], label: string, value: string | null): ConditionRow {
  return value === null
    ? { key, label, value: NOT_INFORMED_LABEL, informed: false }
    : { key, label, value, informed: true };
}

/**
 * Condiciones laborales de la oferta (R17-04), solo con campos ya extraídos: lo que el aviso no dice
 * queda como «No lo informa», nunca se supone. Sin consultas: usa lo que la página ya trae.
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
        ? "No lo pide"
        : `Inglés ${ENGLISH_LABEL[eng] ?? clean(eng) ?? ""}`.trim();

  const years = input.yearsRequired;
  const seniority =
    years === null || !Number.isFinite(years)
      ? null
      : `${years} ${years === 1 ? "año" : "años"} de experiencia`;

  return [
    row("salary", "Sueldo", salary),
    row("modality", "Modalidad", modality),
    row("language", "Idioma", language),
    row("seniority", "Seniority", seniority),
    row("contract", "Tipo de contrato", clean(input.contractType)),
  ];
}
