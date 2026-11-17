/**
 * Lo que ve la persona en «Lo que le falta a tu CV para {puesto}» (ADR-038 §4). Plantillas del código por
 * tipo de problema: el modelo eligió el tipo, no escribe el texto. Las únicas partes variables salen de la
 * base (empresa, cargo, proyecto, estudio), de la taxonomía (nombre de la skill), del perfil (puesto) o de
 * la cita ya validada como substring del ítem. Puro.
 */
import type { CvIssueSeverity, CvIssueType } from "../issues";
import type { CvCoachSection, CvIssue } from "../schemas";
import type { CvReviewContext, CvReviewItem } from "./review";

export type CvIssueView = {
  id: string;
  type: CvIssueType;
  severity: CvIssueSeverity;
  /** Qué falta, en una oración, con el ancla del ítem. */
  title: string;
  /** Qué ayudaría, en una oración. */
  hint: string;
  /** Empresa, proyecto, estudio, skill o sección a la que apunta. */
  anchor: string;
  /** Cita literal del ítem (ya validada) o `null`. */
  quote: string | null;
};

export function cvReviewHeading(target: string): string {
  return `Lo que le falta a tu CV para ${target}`;
}

const SECTION_ANCHOR: Record<CvCoachSection, string> = {
  experience: "tu experiencia",
  projects: "tus proyectos",
  education: "tus estudios",
  skills: "tus skills",
  summary: "tu resumen",
};

function itemAnchor(item: CvReviewItem): string {
  if (item.kind === "trabajo") return `${item.title} en ${item.organization}`;
  if (item.kind === "proyecto") return `el proyecto ${item.organization}`;
  return `${item.title} (${item.organization})`;
}

/** Ancla del problema: nunca texto del modelo. */
export function cvIssueAnchor(issue: CvIssue, ctx: CvReviewContext): string {
  const { section, itemId } = issue.ref;
  if (section === "skills") {
    const slug = issue.skillSlug ?? itemId;
    if (slug !== null) return ctx.taxonomy.find((t) => t.slug === slug)?.name ?? slug;
    return SECTION_ANCHOR.skills;
  }
  if (itemId !== null) {
    const item = ctx.items.find((i) => i.id === itemId);
    if (item) return itemAnchor(item);
  }
  return SECTION_ANCHOR[section];
}

type Template = (a: { anchor: string; target: string }) => { title: string; hint: string };

const TEMPLATES: Record<CvIssueType, Template> = {
  logro_sin_resultado: ({ anchor }) => ({
    title: `En ${anchor} contás qué hiciste, pero no qué resultado tuvo.`,
    hint: "Ayuda sumar un número, un antes y un después, o a quién le sirvió.",
  }),
  tarea_vaga: ({ anchor }) => ({
    title: `En ${anchor} hay tareas contadas de forma general.`,
    hint: "Ayuda decir qué hiciste vos, con qué herramienta y para qué.",
  }),
  vineta_sin_verbo: ({ anchor }) => ({
    title: `En ${anchor} hay viñetas que no arrancan con lo que hiciste.`,
    hint: "Ayuda empezar cada viñeta con una acción: armé, coordiné, reduje.",
  }),
  skill_pedida_sin_evidencia: ({ anchor, target }) => ({
    title: `Los avisos de ${target} piden ${anchor} y la tenés en tu perfil, pero ningún trabajo ni proyecto lo muestra.`,
    hint: "Ayuda contar dónde la usaste: en qué trabajo o proyecto y para qué.",
  }),
  proyecto_sin_stack_o_link: ({ anchor }) => ({
    title: `En ${anchor} no figura con qué lo hiciste ni dónde verlo.`,
    hint: "Ayuda sumar las herramientas que usaste y, si hay, un link público.",
  }),
  brecha_con_puesto: ({ anchor, target }) => ({
    title: `Los avisos de ${target} piden ${anchor} y no aparece en tu CV.`,
    hint: "Si la usaste alguna vez, contá dónde; si no, es algo para aprender.",
  }),
  fecha_faltante: ({ anchor }) => ({
    title: `En ${anchor} faltan las fechas.`,
    hint: "Alcanza con el mes y el año de inicio y de fin.",
  }),
  inconsistencia: ({ anchor }) => ({
    title: `En ${anchor} hay datos que no cierran entre sí.`,
    hint: "Conviene revisar las fechas y el cargo para que coincidan.",
  }),
  resumen_generico: ({ target }) => ({
    title: `Tu resumen no dice qué te distingue para ${target}.`,
    hint: "Ayuda nombrar lo que más hiciste y el tipo de puesto que buscás.",
  }),
  orden_poco_relevante: ({ anchor, target }) => ({
    title: `En ${anchor}, lo más relevante para ${target} no está primero.`,
    hint: "Conviene subir lo que más se parece a lo que piden los avisos.",
  }),
};

/** Vista de un problema para la pantalla del diagnóstico. */
export function cvIssueView(issue: CvIssue, ctx: CvReviewContext): CvIssueView {
  const anchor = cvIssueAnchor(issue, ctx);
  const { title, hint } = TEMPLATES[issue.type]({ anchor, target: ctx.target });
  return {
    id: issue.id,
    type: issue.type,
    severity: issue.severity,
    title,
    hint,
    anchor,
    quote: issue.quote,
  };
}

export function cvIssueViews(issues: readonly CvIssue[], ctx: CvReviewContext): CvIssueView[] {
  return issues.map((i) => cvIssueView(i, ctx));
}
