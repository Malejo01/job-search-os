/**
 * Variables del prompt `cv_review@v1` (ADR-038 §10). Puro. Al modelo va el CV **confirmado** (las filas de
 * `career_history`, ADR-008), no el texto crudo, delimitado como dato entre `<<<CV>>>` y `<<<FIN CV>>>`
 * con el mismo neutralizado de `buildCvPromptVars`: `<<<` y `>>>` del CV no pueden cerrar el bloque. Cada
 * ítem lleva su id para que el modelo apunte a él; el código valida después que exista.
 */
import type { CvCoachSection } from "../schemas";
import {
  CV_REVIEW_DEMAND_MIN_MENTIONS,
  CV_REVIEW_DEMAND_TOP,
  cvSectionOfKind,
  type CvReviewContext,
  type CvReviewItem,
} from "./review";

/**
 * Tope del CV que va al modelo, en caracteres del bloque. Acota el costo máximo del paso (la reserva de
 * `cv_review` se calcula con este tope, ver `adapters/src/cv-coach/review/estimate.test.ts`). Si el CV
 * confirmado es más largo, entran los ítems más recientes hasta el tope; los demás siguen valiendo como
 * referencia, pero el modelo no los ve.
 */
export const CV_REVIEW_MAX_CV_CHARS = 14_000;
/** Skills de la persona que se listan en el prompt. */
export const CV_REVIEW_MAX_PERSON_SKILLS = 40;

export type CvReviewPromptVars = {
  target: string;
  cv: string;
  person_skills: string;
  demand: string;
};

const neutralize = (text: string): string => text.replace(/<{3,}/g, "‹‹‹").replace(/>{3,}/g, "›››");
const oneLine = (text: string): string => neutralize(text).replace(/\s+/g, " ").trim();

const SECTION_TITLE: Record<CvCoachSection, string> = {
  experience: "experience (trabajos)",
  projects: "projects (proyectos)",
  education: "education (estudios y certificaciones)",
  skills: "skills",
  summary: "summary (resumen)",
};

/** Vigentes primero, después por fin (o inicio) más reciente; sin fechas, al final. */
function byRecency(a: CvReviewItem, b: CvReviewItem): number {
  const key = (i: CvReviewItem) =>
    i.startMonth !== null && i.endMonth === null ? "9999-12" : (i.endMonth ?? i.startMonth ?? "");
  const ka = key(a);
  const kb = key(b);
  return ka < kb ? 1 : ka > kb ? -1 : 0;
}

/** Texto del CV confirmado, por sección, con el id de cada ítem. Es lo que pasa por `detectCvInjection`. */
export function cvReviewCvText(ctx: CvReviewContext): string {
  const block = (i: CvReviewItem): string => {
    const dates = `${i.startMonth ?? "sin fecha"} a ${i.endMonth ?? (i.startMonth ? "actual" : "sin fecha")}`;
    const link = i.link ? ` · link: sí` : "";
    return [
      `[id: ${i.id}] ${oneLine(i.title)} · ${oneLine(i.organization)} · ${dates}${link}`,
      ...i.bullets.map((b) => `- ${oneLine(b)}`),
    ].join("\n");
  };
  const summary = ctx.summary !== null ? oneLine(ctx.summary).slice(0, 1500) : null;
  // Qué ítems entran: los más recientes primero, hasta el tope (con margen para títulos y resumen)
  let budget = CV_REVIEW_MAX_CV_CHARS - 200 - (summary?.length ?? 0);
  const included = new Set<string>();
  for (const i of [...ctx.items].sort(byRecency)) {
    const size = block(i).length + 1;
    if (size > budget) continue;
    budget -= size;
    included.add(i.id);
  }
  const lines: string[] = [];
  for (const section of ["experience", "projects", "education"] as const) {
    const items = ctx.items.filter(
      (i) => cvSectionOfKind(i.kind) === section && included.has(i.id),
    );
    if (items.length === 0) continue;
    lines.push(`## ${SECTION_TITLE[section]}`);
    for (const i of items) lines.push(block(i));
  }
  if (summary !== null) {
    lines.push(`## ${SECTION_TITLE.summary}`);
    lines.push(summary);
  }
  return lines.join("\n");
}

export function cvReviewPromptVars(ctx: CvReviewContext): CvReviewPromptVars {
  const names = new Map(ctx.taxonomy.map((t) => [t.slug, t.name]));
  const skills = ctx.personSkills
    .filter((s) => names.has(s))
    .slice(0, CV_REVIEW_MAX_PERSON_SKILLS)
    .map((s) => `${s} | ${names.get(s)}`)
    .join("\n");
  const demand = ctx.demand
    .filter((d) => d.mentions >= CV_REVIEW_DEMAND_MIN_MENTIONS && names.has(d.slug))
    .slice(0, CV_REVIEW_DEMAND_TOP)
    .map((d) => `${d.slug} | ${names.get(d.slug)} | ${d.mentions}`)
    .join("\n");
  const cv = cvReviewCvText(ctx);
  return {
    target: oneLine(ctx.target).slice(0, 120),
    cv: `<<<CV>>>\n${cv.length > 0 ? cv : "(vacío)"}\n<<<FIN CV>>>`,
    person_skills: skills.length > 0 ? skills : "(ninguna)",
    demand: demand.length > 0 ? demand : "(sin datos del mercado)",
  };
}
