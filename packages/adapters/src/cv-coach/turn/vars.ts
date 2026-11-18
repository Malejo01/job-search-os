/**
 * Variables del prompt `cv_coach_turn@v1` (ADR-038 §10). El CV confirmado y el mensaje de la persona entran
 * **delimitados como dato** (`buildCvPromptVars` y un bloque propio para el mensaje): los marcadores `<<<` y
 * `>>>` de lo que escribió la persona no pueden abrir ni cerrar un bloque. Lo que arma el código (tipo de
 * problema, id del ítem, nombre de la skill de la taxonomía) va fuera de los bloques.
 */
import {
  buildCvPromptVars,
  formatCoachRange,
  type CvCoachItem,
  type CvCoachTurnContext,
  type CvIssue,
} from "@job-search-os/pipeline";

const SECTION_LABEL: Record<CvCoachItem["section"], string> = {
  experience: "trabajo",
  projects: "proyecto",
  education: "estudio",
};

/**
 * El CV confirmado como texto, con el id de cada ítem para que el modelo pueda apuntar `ref`. Las viñetas
 * van solo de los ítems de `detail` (el del problema en foco y el del que sigue): el resto entra con su
 * encabezado, que alcanza para ubicar lo dicho fuera de foco. Así el turno queda acotado (plan §3).
 * Sin `detail`, van todas (para revisar instrucciones escondidas en todo lo confirmado).
 */
export function coachCvText(ctx: CvCoachTurnContext, detail?: ReadonlySet<string>): string {
  const lines = [`Puesto objetivo: ${ctx.target}`];
  for (const item of ctx.items) {
    const dates = formatCoachRange(item) ?? "sin fechas";
    const link = item.link ? ` | link: ${item.link}` : "";
    lines.push(
      `[${item.section} ${item.id}] ${SECTION_LABEL[item.section]}: ${item.organization} | ${item.title} | ${dates}${link}`,
    );
    if (!detail || detail.has(item.id)) for (const b of item.bullets) lines.push(`- ${b}`);
  }
  return lines.join("\n");
}

/** Texto del CV que se revisa con `detectCvInjection` antes de llamar (todo lo que entra al prompt). */
export function coachCvInjectionText(ctx: CvCoachTurnContext): string {
  return [coachCvText(ctx), ...Object.values(ctx.skillNames)].join("\n");
}

const neutralize = (text: string): string => text.replace(/<{3,}/g, "‹‹‹").replace(/>{3,}/g, "›››");

/** Descripción de un problema con datos del código: tipo, sección, id del ítem y skill de la taxonomía. */
export function coachIssueLine(issue: CvIssue | null, ctx: CvCoachTurnContext): string {
  if (!issue) return "ninguno (la charla termina si este se cierra)";
  const parts = [`tipo: ${issue.type}`, `sección: ${issue.ref.section}`];
  if (issue.ref.itemId) parts.push(`ítem: ${issue.ref.itemId}`);
  if (issue.ref.field) parts.push(`campo: ${issue.ref.field}`);
  const skill = issue.skillSlug ? ctx.skillNames[issue.skillSlug] : undefined;
  if (skill) parts.push(`skill: ${skill}`);
  return parts.join(" · ");
}

export function coachTurnVars(input: {
  ctx: CvCoachTurnContext;
  focus: CvIssue;
  next: CvIssue | null;
  followUp: boolean;
  message: string;
  today: string;
}): Record<string, string> {
  const detail = new Set(
    [input.focus.ref.itemId, input.next?.ref.itemId].filter((x): x is string => !!x),
  );
  const cv = buildCvPromptVars({
    text: coachCvText(input.ctx, detail),
    roleLabels: [],
    candidates: [],
    today: input.today,
  });
  return {
    today: cv.today,
    cv: cv.cv,
    focus: coachIssueLine(input.focus, input.ctx),
    next: coachIssueLine(input.next, input.ctx),
    follow_up: input.followUp ? "sí" : "no",
    message: `<<<MENSAJE>>>\n${neutralize(input.message)}\n<<<FIN MENSAJE>>>`,
  };
}
