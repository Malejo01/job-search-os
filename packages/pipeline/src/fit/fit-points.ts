import type { Checklist, ChecklistItem } from "../evaluator/checklist";
import { foldText } from "../normalize/text";

/**
 * «A tu favor» y «Te falta o te frena» de UNA oferta (C2-2). Puro y determinista: reordena y reescribe
 * en llano lo que la evaluación ya guardó (match, gaps, riesgos, bloqueadores, señales y el checklist);
 * no llama al modelo ni inventa datos. Si la evaluación no trae algo, la lista queda más corta.
 */
export const FIT_POINTS_MAX = 5;
const TEXT_MAX = 140;

export type FavorKind = "cumple" | "match" | "senal";
export type FaltaKind = "frena" | "falta" | "ojo" | "sin_dato";

/** Cómo se rotula cada tipo de punto de «Te falta o te frena». */
export const FALTA_KIND_LABEL: Record<FaltaKind, string> = {
  frena: "Te frena",
  falta: "Te falta",
  ojo: "Ojo",
  sin_dato: "No sabemos",
};

export type FavorPoint = { kind: FavorKind; text: string };
export type FaltaPoint = { kind: FaltaKind; text: string };

export type FitPoints = { favor: FavorPoint[]; falta: FaltaPoint[] };

export type FitPointsInput = {
  /** `evaluations.match_fuerte`. */
  matchFuerte: readonly string[];
  /** `evaluations.senales_positivas`. */
  senales: readonly string[];
  /** `evaluations.gaps` (ya sin el inglés cuando el aviso está en español, si el llamador lo filtra). */
  gaps: readonly string[];
  /** Riesgos ya escritos para mostrar (`riskLabel`). */
  riesgos: readonly string[];
  /** `evaluations.bloqueadores_duros` (los de código incluidos). */
  bloqueadores: readonly string[];
  /** El checklist guardado; null en evaluaciones viejas. */
  checklist?: Pick<Checklist, "items"> | null;
};

const clip = (s: string): string => {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > TEXT_MAX ? `${t.slice(0, TEXT_MAX - 1)}…` : t;
};

const upperFirst = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** Para comparar dos frases: sin acentos, mayúsculas ni signos. */
const key = (s: string): string =>
  foldText(s)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** ¿`a` ya está dicho en `seen`? Igual, o uno contiene al otro (con al menos 12 caracteres). */
function repeated(a: string, seen: readonly string[]): boolean {
  const ka = key(a);
  if (!ka) return true;
  return seen.some((s) => s === ka || (ka.length >= 12 && (s.includes(ka) || ka.includes(s))));
}

const skillName = (item: ChecklistItem): string => item.pide.replace(/^Menciona\s+/i, "");

/** Un requisito que se cumple, en llano. */
function favorFromItem(item: ChecklistItem): string {
  if (item.kind === "skill") return `Ya manejás ${skillName(item)}`;
  if (item.id === "pais") return "Podés trabajar desde tu país";
  if (item.id === "modalidad") return `${upperFirst(item.pide)}: es lo que aceptás`;
  return `${upperFirst(item.pide)}: lo cumplís`;
}

/** Un requisito que no se cumple, en llano. */
function faltaFromItem(item: ChecklistItem): string {
  if (item.kind === "skill") {
    return item.tenes ? `Piden ${skillName(item)} y tu nivel es bajo` : `Piden ${skillName(item)}`;
  }
  if (item.id === "pais") return "El aviso no incluye tu país";
  const tenes = item.tenes ? ` (vos: ${item.tenes})` : "";
  return `${upperFirst(item.pide)}: no lo cumplís${tenes}`;
}

/** Un dato que no podemos verificar con el perfil. */
function sinDatoFromItem(item: ChecklistItem): string {
  if (item.kind === "skill") return `No sabemos tu nivel de ${skillName(item)}`;
  return `No sabemos si cumplís: ${item.pide}`;
}

const MUST_FIRST = (a: ChecklistItem, b: ChecklistItem): number =>
  Number(b.nivel === "must") - Number(a.nivel === "must");

export function buildFitPoints(input: FitPointsInput): FitPoints {
  const items = input.checklist?.items ?? [];

  // ── A tu favor: requisitos que cumplís, lo que ya tenés y las señales positivas ──────────────
  const favor: FavorPoint[] = [];
  const seenFavor: string[] = [];
  const addFavor = (kind: FavorKind, raw: string) => {
    if (favor.length >= FIT_POINTS_MAX) return;
    const text = clip(raw);
    if (repeated(text, seenFavor)) return;
    seenFavor.push(key(text));
    favor.push({ kind, text });
  };
  // Primero lo que el aviso exige y cumplís (sin las skills: las trae el match del modelo)
  for (const it of items.filter((i) => i.status === "cumple" && i.kind !== "skill")) {
    if (it.nivel === "must") addFavor("cumple", favorFromItem(it));
  }
  for (const m of input.matchFuerte) addFavor("match", upperFirst(m));
  for (const it of items.filter((i) => i.status === "cumple" && i.kind === "skill")) {
    addFavor("match", favorFromItem(it));
  }
  for (const s of input.senales) addFavor("senal", upperFirst(s));
  for (const it of items.filter((i) => i.status === "cumple" && i.nivel !== "must")) {
    addFavor("cumple", favorFromItem(it));
  }

  // ── Te falta o te frena: bloqueadores, requisitos no cumplidos, gaps, riesgos, datos que faltan ─
  const falta: FaltaPoint[] = [];
  const seenFalta: string[] = [];
  const addFalta = (kind: FaltaKind, raw: string) => {
    if (falta.length >= FIT_POINTS_MAX) return;
    const text = clip(raw);
    if (repeated(text, seenFalta)) return;
    seenFalta.push(key(text));
    falta.push({ kind, text });
  };
  for (const b of input.bloqueadores) addFalta("frena", upperFirst(b));
  const blocked = input.bloqueadores.length > 0;
  // El ítem que ya frena está dicho en el bloqueador: no se repite con otras palabras
  for (const it of items.filter((i) => i.status === "no_cumple").sort(MUST_FIRST)) {
    if (blocked && it.bloquea) continue;
    addFalta(it.bloquea ? "frena" : "falta", faltaFromItem(it));
  }
  for (const g of input.gaps) addFalta("falta", upperFirst(g));
  for (const r of input.riesgos) addFalta("ojo", upperFirst(r));
  for (const it of items.filter((i) => i.status === "no_se_sabe").sort(MUST_FIRST)) {
    addFalta("sin_dato", sinDatoFromItem(it));
  }

  return { favor, falta };
}

export type FitCardSummary = {
  favor: FavorPoint | null;
  /** Con el rótulo ya escrito («Te frena», «Te falta»…): la tarjeta es un componente de cliente. */
  falta: (FaltaPoint & { label: string }) | null;
};

/**
 * Resumen de la tarjeta de /jobs: 1 punto a favor y 1 que falta o frena (a lo sumo 2 ítems). Usa solo
 * lo barato de leer (sin el checklist, que vive en `decision`): primero lo más fuerte.
 */
export function summarizeFitCard(input: Omit<FitPointsInput, "checklist">): FitCardSummary {
  const { favor, falta } = buildFitPoints({ ...input, checklist: null });
  const first = falta[0];
  return {
    favor: favor[0] ?? null,
    falta: first ? { ...first, label: FALTA_KIND_LABEL[first.kind] } : null,
  };
}
