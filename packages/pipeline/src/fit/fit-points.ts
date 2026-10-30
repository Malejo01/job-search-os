import type { Checklist, ChecklistItem } from "../evaluator/checklist";
import { foldText } from "../normalize/text";

/**
 * «A tu favor» y «Te falta o te frena» de UNA oferta (C2-2). Puro y determinista: reordena y reescribe
 * en llano lo que la evaluación ya guardó (match, gaps, riesgos, bloqueadores, señales y el checklist);
 * no llama al modelo ni inventa datos. Si la evaluación no trae algo, la lista queda más corta.
 */
export const FIT_POINTS_MAX = 5;
/** Skills por lista: el checklist trae hasta 20 y no deben tapar lo demás. */
const SKILLS_MAX = 3;
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
  /** `evaluations.gaps` (el llamador saca el inglés cuando el aviso está en español). */
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
const lowerFirst = (s: string): string => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

/** Para comparar dos frases: sin acentos ni mayúsculas; conserva +, # y . (C++, C#, .NET son distintos). */
const key = (s: string): string =>
  foldText(s)
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\.(?=\s|$)/g, "")
    .trim();

/** ¿La frase más corta está entera, como palabras, dentro de la más larga? (mínimo 5 caracteres) */
function contains(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 5 && ` ${long} `.includes(` ${short} `);
}

function repeated(a: string, seen: readonly string[]): boolean {
  const ka = key(a);
  if (!ka) return false;
  return seen.some((s) => s === ka || contains(ka, s));
}

const skillName = (item: ChecklistItem): string => item.pide.replace(/^Menciona\s+/i, "");

/** Un requisito que se cumple, en llano. */
function favorFromItem(item: ChecklistItem): string {
  switch (item.kind === "skill" ? "skill" : item.id) {
    case "skill":
      return `Ya manejás ${skillName(item)}`;
    case "pais":
      return "Podés trabajar desde tu país";
    case "modalidad":
      return `Es ${item.pide.replace(/^Modalidad\s+/i, "")} y eso aceptás`;
    case "anos":
      return "Tenés los años de experiencia que piden";
    case "ingles":
      return "Tu inglés alcanza";
    case "salario":
      return "El sueldo publicado llega a tu mínimo";
    case "jornada":
      return "La jornada entra en tu máximo de horas";
    case "disciplina":
      return "Es un puesto de tu mismo oficio";
    case "autorizacion":
      return "Tenés el permiso de trabajo que piden";
    default:
      return `${upperFirst(item.pide)}: lo cumplís`;
  }
}

/** Un requisito que no se cumple, en llano. */
function faltaFromItem(item: ChecklistItem): string {
  switch (item.kind === "skill" ? "skill" : item.id) {
    case "skill":
      return item.tenes
        ? `Piden ${skillName(item)} y tu nivel es bajo`
        : `Piden ${skillName(item)}`;
    case "pais":
      return "El aviso no incluye tu país";
    case "residencia":
      return `Piden vivir en ${item.pide.replace(/^Residir en\s+/i, "")}`;
    case "modalidad": {
      const acepta = (item.tenes ?? "").replace(/^Aceptás:\s*/i, "");
      return `Es ${item.pide.replace(/^Modalidad\s+/i, "")}${acepta ? ` y vos aceptás: ${acepta}` : ""}`;
    }
    case "anos":
      return `Piden ${item.pide}${item.tenes ? ` y tenés ${item.tenes}` : ""}`;
    case "ingles":
      return `Piden ${lowerFirst(item.pide)}, más de tu nivel`;
    case "salario":
      return "El sueldo publicado queda por debajo de tu mínimo";
    case "jornada":
      return "La jornada supera tu máximo de horas";
    case "disciplina":
      return "Es un puesto de otro oficio que el tuyo";
    case "autorizacion":
      return "Piden un permiso de trabajo que no tenés";
    default:
      return `${upperFirst(item.pide)}: no lo cumplís`;
  }
}

/** Un dato que no podemos verificar con el perfil (el rótulo «No sabemos» lo pone la pantalla). */
function sinDatoFromItem(item: ChecklistItem): string {
  switch (item.kind === "skill" ? "skill" : item.id) {
    case "skill":
      return `tu nivel de ${skillName(item)}`;
    case "pais":
      return "desde qué países contrata el aviso";
    case "anos":
      return "tus años de experiencia (completalos en tu perfil)";
    case "ingles":
      return "tu nivel de inglés (completalo en tu perfil)";
    case "salario":
      return "tu sueldo mínimo (completalo en tu perfil)";
    case "jornada":
      return "tus horas máximas por semana (completalo en tu perfil)";
    default:
      return lowerFirst(item.pide);
  }
}

/**
 * Los bloqueadores los escribe `decide()` en lenguaje interno («años requeridos ≥ 8 (10)»,
 * «disciplina distinta (x)»): acá se pasan a llano. Lo que no reconoce (por ejemplo, lo que escribe
 * el modelo) queda como está.
 */
export function blockerInPlainSpanish(raw: string): string {
  const b = raw.trim();
  let m: RegExpExecArray | null;
  if ((m = /^años requeridos ≥ \d+ \((\d+)\)/i.exec(b))) {
    return `Piden ${m[1]} años de experiencia, más de lo que admite tu búsqueda`;
  }
  if ((m = /^gap de años: pide (\d+), el candidato tiene (\d+)/i.exec(b))) {
    return `Piden ${m[1]} años de experiencia y tenés ${m[2]}`;
  }
  if ((m = /^años en otro dominio \((.+)\)/i.exec(b))) {
    return `Los años que piden son de otro rubro (${m[1]}), no del tuyo`;
  }
  if (/^disciplina distinta/i.test(b)) return "Es un puesto de otro oficio que el tuyo";
  if ((m = /^jornada de (\d+) h \(máximo (\d+)\)/i.exec(b))) {
    return `La jornada es de ${m[1]} horas por semana y tu máximo es ${m[2]}`;
  }
  if ((m = /^salario publicado por debajo del piso \(USD ([\d.,]+)\/mes < ([\d.,]+)\)/i.exec(b))) {
    return `Pagan hasta USD ${m[1]} por mes y tu mínimo es USD ${m[2]}`;
  }
  if ((m = /^residencia exigida en (.+)/i.exec(b))) return `Piden vivir en ${m[1]}`;
  if ((m = /^aviso limitado a (.+?) \(no incluye tu país\)/i.exec(b))) {
    return `El aviso es solo para ${m[1]} y no incluye tu país`;
  }
  return upperFirst(b);
}

const MUST_FIRST = (a: ChecklistItem, b: ChecklistItem): number =>
  Number(b.nivel === "must") - Number(a.nivel === "must");

export function buildFitPoints(input: FitPointsInput): FitPoints {
  const items = input.checklist?.items ?? [];
  const skillKeys = items.filter((i) => i.kind === "skill").map((i) => key(skillName(i)));
  // La skill que el checklist ya evalúa con los niveles de hoy manda sobre la foto del modelo
  const isChecklistSkill = (text: string): boolean => {
    const k = key(text);
    return skillKeys.some((sk) => sk === k || contains(sk, k));
  };

  // ── A tu favor: lo que ya tenés (modelo), requisitos que cumplís, señales y skills del aviso ──
  const favor: FavorPoint[] = [];
  const seenFavor: string[] = [];
  let skillsFavor = 0;
  const addFavor = (kind: FavorKind, raw: string, skill = false) => {
    if (favor.length >= FIT_POINTS_MAX) return;
    if (skill && skillsFavor >= SKILLS_MAX) return;
    const text = clip(raw);
    if (repeated(text, seenFavor)) return;
    seenFavor.push(key(text));
    if (skill) skillsFavor++;
    favor.push({ kind, text });
  };
  const cumple = items.filter((i) => i.status === "cumple");
  for (const m of input.matchFuerte) {
    if (!isChecklistSkill(m)) addFavor("match", upperFirst(m));
  }
  for (const it of cumple.filter((i) => i.kind !== "skill" && i.nivel === "must")) {
    addFavor("cumple", favorFromItem(it));
  }
  for (const it of cumple.filter((i) => i.kind === "skill").sort(MUST_FIRST)) {
    addFavor("match", favorFromItem(it), true);
  }
  for (const s of input.senales) addFavor("senal", upperFirst(s));
  for (const it of cumple.filter((i) => i.kind !== "skill" && i.nivel !== "must")) {
    addFavor("cumple", favorFromItem(it));
  }

  // ── Te falta o te frena: bloqueadores, requisitos no cumplidos, gaps, riesgos, datos que faltan ──
  const falta: FaltaPoint[] = [];
  const seenFalta: string[] = [];
  let skillsFalta = 0;
  const addFalta = (kind: FaltaKind, raw: string, skill = false) => {
    if (falta.length >= FIT_POINTS_MAX) return;
    if (skill && skillsFalta >= SKILLS_MAX) return;
    const text = clip(raw);
    if (repeated(text, seenFalta)) return;
    seenFalta.push(key(text));
    if (skill) skillsFalta++;
    falta.push({ kind, text });
  };
  const blocked = input.bloqueadores.length > 0;
  for (const b of input.bloqueadores) addFalta("frena", blockerInPlainSpanish(b));
  const noCumple = items.filter((i) => i.status === "no_cumple").sort(MUST_FIRST);
  // Si hay un bloqueador, «desde dónde se puede trabajar» ya está dicho: no se repite con el ítem
  const where = (i: ChecklistItem) => i.id === "pais" || i.id === "residencia";
  for (const it of noCumple.filter((i) => i.kind !== "skill")) {
    if (blocked && (it.bloquea || where(it))) continue;
    addFalta(it.bloquea ? "frena" : "falta", faltaFromItem(it));
  }
  for (const g of input.gaps) {
    if (!isChecklistSkill(g)) addFalta("falta", upperFirst(g));
  }
  for (const r of input.riesgos) addFalta("ojo", upperFirst(r));
  for (const it of noCumple.filter((i) => i.kind === "skill")) {
    addFalta("falta", faltaFromItem(it), true);
  }
  for (const it of items.filter((i) => i.status === "no_se_sabe").sort(MUST_FIRST)) {
    addFalta("sin_dato", sinDatoFromItem(it), it.kind === "skill");
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
