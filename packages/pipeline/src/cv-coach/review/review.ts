/**
 * Diagnóstico del coach de CV (ADR-038 §4, R12-8). Puro: recibe lo confirmado (filas de `career_history`
 * leídas con RLS), las skills de la persona, la taxonomía, el puesto objetivo y la demanda del pool
 * (`computeDemand`), más lo que propuso `cv_review` (ya validado con su esquema), y devuelve la lista de
 * problemas que el código acepta:
 *
 * 1. **Referencias:** se descarta todo problema cuyo `ref` apunte a un ítem que no existe, a una sección que
 *    no es la del ítem, o cuyo `skillSlug` no esté en la taxonomía. Algunos tipos se comprueban con los
 *    datos (`fecha_faltante` solo si el ítem no tiene fecha de inicio; `proyecto_sin_stack_o_link` solo en
 *    proyectos; los de viñetas solo en ítems con viñetas; `resumen_generico` solo si hay resumen).
 * 2. **Citas:** se conservan solo si son substring normalizado (`foldCvText`, espacios colapsados) de un
 *    campo del ítem. Si no, el problema queda sin cita.
 * 3. **Brechas desde datos:** `brecha_con_puesto` y `skill_pedida_sin_evidencia` las calcula el código con
 *    la demanda del pool; lo que propone el modelo para esos tipos solo se acepta si coincide (y la
 *    severidad es la de los datos).
 * 4. **Orden:** severidad, prioridad fija por tipo (`CV_ISSUE_PRIORITY`), ítem más reciente y, para que el
 *    resultado no dependa del orden en que llegó la salida del modelo, una clave estable al final.
 * 5. **Recorte:** `CV_COACH_MAX_ISSUES_PER_ITEM` por ítem y `CV_COACH_MAX_ISSUES` en total; ids `iss:<n>`.
 *
 * Nada de acá produce texto para la persona: eso es `texts.ts`, con plantillas.
 */
import type { SkillDemand } from "../../skills/market";
import type { SkillTaxonomyEntry } from "../../skills/match";
import { foldCvText } from "../../cv-out/verify";
import {
  CV_COACH_MAX_ISSUES,
  CV_COACH_MAX_ISSUES_PER_ITEM,
  CV_ISSUE_DATA_TYPES,
  cvIssuePriority,
  cvIssueSeverityRank,
  type CvIssueSeverity,
  type CvIssueType,
} from "../issues";
import {
  CV_COACH_FIELDS,
  CV_COACH_SECTIONS,
  type CvCoachSection,
  type CvIssue,
  type CvItemRef,
  type CvReviewProposedIssue,
} from "../schemas";

export const CV_REVIEW_ITEM_KINDS = ["trabajo", "educacion", "certificacion", "proyecto"] as const;
export type CvReviewItemKind = (typeof CV_REVIEW_ITEM_KINDS)[number];

/** Un ítem confirmado del CV: una fila de `career_history` (el `link` llega con R12-4). */
export type CvReviewItem = {
  id: string;
  kind: CvReviewItemKind;
  organization: string;
  title: string;
  startMonth: string | null;
  endMonth: string | null;
  bullets: readonly string[];
  link: string | null;
};

export type CvReviewContext = {
  /** Puesto objetivo del perfil. */
  target: string;
  items: readonly CvReviewItem[];
  /** Slugs de las skills que la persona tiene confirmadas. */
  personSkills: readonly string[];
  taxonomy: readonly SkillTaxonomyEntry[];
  /** Demanda del pool de la carrera, ordenada como la devuelve `computeDemand`. */
  demand: readonly SkillDemand[];
  /** Resumen del perfil, si hay. Sin resumen no hay `resumen_generico`. */
  summary: string | null;
};

/** Skills más pedidas que se miran para las brechas, y menciones mínimas para que una cuente. */
export const CV_REVIEW_DEMAND_TOP = 8;
export const CV_REVIEW_DEMAND_MIN_MENTIONS = 2;
/** Brechas de datos como máximo (las más pedidas primero): el resto de la lista es para el CV. */
export const CV_REVIEW_MAX_DATA_GAPS = 4;
/** Las primeras N skills del ranking son de severidad alta; las demás, media. */
export const CV_REVIEW_HIGH_SEVERITY_RANK = 3;
/** Una cita más corta que esto (normalizada) no prueba nada: se descarta. */
export const CV_REVIEW_MIN_QUOTE_CHARS = 4;

/** Sección que corresponde a cada tipo de ítem. */
export function cvSectionOfKind(kind: CvReviewItemKind): CvCoachSection {
  if (kind === "trabajo") return "experience";
  if (kind === "proyecto") return "projects";
  return "education";
}

/** Plegado para comparar: minúsculas, sin acentos, espacios colapsados. */
export function foldForQuote(s: string): string {
  return foldCvText(s).replace(/\s+/g, " ").trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Términos con los que una skill puede aparecer en el texto: nombre, alias y slug con espacios. */
function skillTerms(entry: SkillTaxonomyEntry): string[] {
  const raw = [entry.name, ...entry.aliases, entry.slug.replace(/[-_]+/g, " ")];
  return [...new Set(raw.map(foldForQuote).filter((t) => t.length > 0))];
}

function mentions(text: string, term: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(term)}(?![\\p{L}\\p{N}])`, "u").test(text);
}

function itemText(item: CvReviewItem): string {
  return foldForQuote([item.organization, item.title, ...item.bullets].join("\n"));
}

export type CvSkillGap = {
  type: "brecha_con_puesto" | "skill_pedida_sin_evidencia";
  skillSlug: string;
  severity: CvIssueSeverity;
};

/**
 * Brechas calculadas con la demanda del pool (ADR-038 §4): de las skills más pedidas,
 * - `brecha_con_puesto`: la persona no la tiene y no aparece en ningún trabajo ni proyecto;
 * - `skill_pedida_sin_evidencia`: la persona la tiene, pero ningún trabajo ni proyecto la muestra.
 * Sin pool no hay brechas: no se inventan.
 */
export function cvSkillGaps(ctx: CvReviewContext): CvSkillGap[] {
  const bySlug = new Map(ctx.taxonomy.map((t) => [t.slug, t]));
  const has = new Set(ctx.personSkills);
  const evidence = ctx.items
    .filter((i) => i.kind === "trabajo" || i.kind === "proyecto")
    .map(itemText);
  const ranked = ctx.demand
    .filter((d) => d.mentions >= CV_REVIEW_DEMAND_MIN_MENTIONS && bySlug.has(d.slug))
    .slice(0, CV_REVIEW_DEMAND_TOP);
  const out: CvSkillGap[] = [];
  ranked.forEach((d, rank) => {
    const entry = bySlug.get(d.slug)!;
    const terms = skillTerms(entry);
    const shown = evidence.some((text) => terms.some((t) => mentions(text, t)));
    if (shown) return;
    const severity: CvIssueSeverity = rank < CV_REVIEW_HIGH_SEVERITY_RANK ? "alta" : "media";
    out.push({
      type: has.has(d.slug) ? "skill_pedida_sin_evidencia" : "brecha_con_puesto",
      skillSlug: d.slug,
      severity,
    });
  });
  return out.slice(0, CV_REVIEW_MAX_DATA_GAPS);
}

/** Tipos que necesitan un ítem concreto con viñetas. */
const BULLET_TYPES: readonly CvIssueType[] = [
  "logro_sin_resultado",
  "tarea_vaga",
  "vineta_sin_verbo",
];

type Candidate = Omit<CvIssue, "id">;

/** Cita válida (normalizada en espacios) o `null`. */
function validQuote(quote: string | null, item: CvReviewItem | undefined): string | null {
  if (quote === null || !item) return null;
  const shown = quote.replace(/\s+/g, " ").trim();
  const folded = foldForQuote(shown);
  if (folded.length < CV_REVIEW_MIN_QUOTE_CHARS) return null;
  const fields = [item.organization, item.title, ...item.bullets].map(foldForQuote);
  return fields.some((f) => f.includes(folded)) ? shown : null;
}

/** ¿El `ref` apunta a algo que existe en lo confirmado? Devuelve el ítem (si apunta a uno). */
function checkRef(
  ref: CvItemRef,
  ctx: CvReviewContext,
): { ok: true; item: CvReviewItem | undefined } | { ok: false } {
  if (ref.section === "summary") {
    return ref.itemId === null && ctx.summary !== null
      ? { ok: true, item: undefined }
      : { ok: false };
  }
  if (ref.section === "skills") {
    if (ref.itemId === null) return { ok: true, item: undefined };
    return ctx.taxonomy.some((t) => t.slug === ref.itemId)
      ? { ok: true, item: undefined }
      : { ok: false };
  }
  if (ref.itemId === null) {
    // la sección entera: tiene que haber al menos un ítem de esa sección
    return ctx.items.some((i) => cvSectionOfKind(i.kind) === ref.section)
      ? { ok: true, item: undefined }
      : { ok: false };
  }
  const item = ctx.items.find((i) => i.id === ref.itemId);
  if (!item || cvSectionOfKind(item.kind) !== ref.section) return { ok: false };
  return { ok: true, item };
}

/** Valida un problema propuesto por el modelo que no es de datos. `null` = descartado. */
function acceptModelIssue(p: CvReviewProposedIssue, ctx: CvReviewContext): Candidate | null {
  if (p.skillSlug !== null && !ctx.taxonomy.some((t) => t.slug === p.skillSlug)) return null;
  const checked = checkRef(p.ref, ctx);
  if (!checked.ok) return null;
  const item = checked.item;
  if (BULLET_TYPES.includes(p.type) && (!item || item.bullets.length === 0)) return null;
  if (p.type === "fecha_faltante" && (!item || item.startMonth !== null)) return null;
  if (p.type === "proyecto_sin_stack_o_link" && (!item || item.kind !== "proyecto")) return null;
  if (p.type === "resumen_generico" && p.ref.section !== "summary") return null;
  return {
    type: p.type,
    ref: { ...p.ref },
    quote: validQuote(p.quote, item),
    skillSlug: p.skillSlug,
    severity: p.severity,
    source: "model",
  };
}

const sectionRank = (s: CvCoachSection) => CV_COACH_SECTIONS.indexOf(s);
const fieldRank = (f: CvItemRef["field"]) => (f === null ? -1 : CV_COACH_FIELDS.indexOf(f));

/** Más reciente primero: un ítem vigente (con inicio y sin fin) va arriba de todo. */
function recency(ref: CvItemRef, ctx: CvReviewContext): string {
  const item = ref.itemId === null ? undefined : ctx.items.find((i) => i.id === ref.itemId);
  if (!item) return "";
  if (item.startMonth !== null && item.endMonth === null) return "9999-12";
  return item.endMonth ?? item.startMonth ?? "";
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function compare(a: Candidate, b: Candidate, ctx: CvReviewContext): number {
  return (
    cvIssueSeverityRank(a.severity) - cvIssueSeverityRank(b.severity) ||
    cvIssuePriority(a.type) - cvIssuePriority(b.type) ||
    cmpStr(recency(b.ref, ctx), recency(a.ref, ctx)) ||
    // clave estable: el resultado no depende del orden de la salida del modelo
    sectionRank(a.ref.section) - sectionRank(b.ref.section) ||
    cmpStr(a.ref.itemId ?? "", b.ref.itemId ?? "") ||
    cmpStr(a.skillSlug ?? "", b.skillSlug ?? "") ||
    fieldRank(a.ref.field) - fieldRank(b.ref.field) ||
    // con cita antes que sin cita; entre citas, la más corta y después la alfabética
    (a.quote === null ? 1 : 0) - (b.quote === null ? 1 : 0) ||
    (a.quote?.length ?? 0) - (b.quote?.length ?? 0) ||
    cmpStr(a.quote ?? "", b.quote ?? "")
  );
}

const dupKey = (c: Candidate) =>
  `${c.type}|${c.ref.section}|${c.ref.itemId ?? ""}|${c.skillSlug ?? ""}`;
const itemKey = (ref: CvItemRef) => `${ref.section}|${ref.itemId ?? ""}`;

/**
 * Lista final de problemas: propuestas del modelo validadas más las brechas de datos, sin duplicados,
 * ordenada y recortada. `proposed = null` (no se llamó al modelo, por ejemplo con inyección detectada)
 * deja solo las brechas de datos.
 */
export function buildCvDiagnosis(
  ctx: CvReviewContext,
  proposed: readonly CvReviewProposedIssue[] | null,
): CvIssue[] {
  const dataGaps = cvSkillGaps(ctx);
  const fromModel = new Set<string>();
  const candidates: Candidate[] = [];
  for (const p of proposed ?? []) {
    if (CV_ISSUE_DATA_TYPES.includes(p.type)) {
      // solo si coincide con lo calculado: el tipo y la skill (el modelo no decide la severidad)
      const hit = dataGaps.find((g) => g.type === p.type && g.skillSlug === p.skillSlug);
      if (hit) fromModel.add(`${hit.type}|${hit.skillSlug}`);
      continue;
    }
    const accepted = acceptModelIssue(p, ctx);
    if (accepted) candidates.push(accepted);
  }
  for (const g of dataGaps) {
    candidates.push({
      type: g.type,
      ref: { section: "skills", itemId: g.skillSlug, field: null },
      quote: null,
      skillSlug: g.skillSlug,
      severity: g.severity,
      source: fromModel.has(`${g.type}|${g.skillSlug}`) ? "model" : "data",
    });
  }

  candidates.sort((a, b) => compare(a, b, ctx));
  const seen = new Set<string>();
  const perItem = new Map<string, number>();
  const out: CvIssue[] = [];
  for (const c of candidates) {
    if (out.length >= CV_COACH_MAX_ISSUES) break;
    const dup = dupKey(c);
    if (seen.has(dup)) continue;
    const key = itemKey(c.ref);
    const n = perItem.get(key) ?? 0;
    if (n >= CV_COACH_MAX_ISSUES_PER_ITEM) continue;
    seen.add(dup);
    perItem.set(key, n + 1);
    out.push({ id: `iss:${out.length + 1}`, ...c });
  }
  return out;
}

/**
 * Vuelve a validar una lista firmada contra lo confirmado HOY (la persona pudo editar o borrar ítems
 * entre el diagnóstico y el turno): descarta los problemas cuyo ítem ya no existe y las citas que ya no
 * están. Conserva los ids (el avance del navegador los usa) y no agrega nada.
 */
export function revalidateCvIssues(issues: readonly CvIssue[], ctx: CvReviewContext): CvIssue[] {
  const out: CvIssue[] = [];
  for (const i of issues) {
    if (i.skillSlug !== null && !ctx.taxonomy.some((t) => t.slug === i.skillSlug)) continue;
    const checked = checkRef(i.ref, ctx);
    if (!checked.ok) continue;
    out.push({ ...i, ref: { ...i.ref }, quote: validQuote(i.quote, checked.item) });
  }
  return out;
}
