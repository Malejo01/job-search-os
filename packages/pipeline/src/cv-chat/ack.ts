/**
 * Acuse del chat de CV armado por el código (R12-3): dice lo que se entendió en el turno con datos que ya
 * pasaron el esquema, el grounding y el filtro de sensibles («Anoté Empresa A, Analista, abril de 2025 a
 * febrero de 2026»). El acuse del modelo es texto libre y con dígitos cae al fijo (`safeCvAck`); este no
 * sale del modelo, así que puede llevar años. Puro.
 */
import { foldCvText } from "../cv-out/verify";
import type { CvChatState, CvWorkDraft } from "./state";

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

/** Nombre del mes de un `AAAA-MM` («febrero»), o `null` si no es un mes válido. */
export function cvMonthName(month: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  return m ? (MONTHS[Number(m[2]) - 1] ?? null) : null;
}

/** «febrero de 2026». */
export function cvMonthLabel(month: string): string {
  const name = cvMonthName(month);
  return name ? `${name} de ${month.slice(0, 4)}` : month;
}

function rangeLabel(w: CvWorkDraft): string | null {
  const from = w.startMonth ? cvMonthLabel(w.startMonth) : null;
  const to = w.endMonth && !w.isCurrent ? cvMonthLabel(w.endMonth) : null;
  if (from && w.isCurrent) return `desde ${from} hasta hoy`;
  if (from && to) return `${from} a ${to}`;
  if (from) return `desde ${from}`;
  if (to) return `hasta ${to}`;
  return null;
}

/** «A, B y C», con «e» antes de una palabra que suena «i». */
export function cvJoinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  const last = items[items.length - 1]!;
  const and = /^h?i(?!e)/.test(foldCvText(last)) ? "e" : "y";
  return `${items.slice(0, -1).join(", ")} ${and} ${last}`;
}

const isNew = (before: string | null | undefined, after: string | null | undefined): boolean =>
  !!after && after !== before;

function workParts(before: CvWorkDraft | undefined, after: CvWorkDraft): string[] {
  const parts: string[] = [];
  if (isNew(before?.organization, after.organization)) parts.push(after.organization!);
  if (isNew(before?.title, after.title)) parts.push(after.title!);
  const datesChanged =
    before?.startMonth !== after.startMonth ||
    before?.endMonth !== after.endMonth ||
    (before?.isCurrent ?? false) !== after.isCurrent;
  const range = datesChanged ? rangeLabel(after) : null;
  if (range) parts.push(range);
  if (after.duties.length > (before?.duties.length ?? 0)) parts.push("lo que hacías");
  if (isNew(before?.achievement, after.achievement)) parts.push("tu logro");
  return parts;
}

const MAX_ACK_CHARS = 300;

/**
 * Lo nuevo entre el estado antes y después del turno, como una frase. `null` si no hay nada nuevo (el tema
 * falló, se dijo «no», o es una confirmación): ahí va el acuse del modelo filtrado, o ninguno.
 */
export function cvUnderstoodAck(before: CvChatState, after: CvChatState): string | null {
  const parts: string[] = [];
  if (isNew(before.target, after.target)) parts.push(`que apuntás a ${after.target}`);
  after.works.forEach((w, i) => parts.push(...workParts(before.works[i], w)));

  const known = new Set(before.projects.map((p) => foldCvText(p.name)));
  const projects = after.projects.filter((p) => !known.has(foldCvText(p.name))).map((p) => p.name);
  if (projects.length === 1) parts.push(`el proyecto ${projects[0]}`);
  if (projects.length > 1) parts.push(`los proyectos ${cvJoinList(projects)}`);

  for (const e of after.education.slice(before.education.length)) {
    parts.push(`${e.title} en ${e.institution}`);
  }
  for (const c of after.certifications.slice(before.certifications.length)) parts.push(c.title);
  const hadSkill = new Set(before.skills.map((x) => foldCvText(x)));
  const skills = after.skills.filter((x) => !hadSkill.has(foldCvText(x)));
  if (skills.length > 0 && skills.length <= 3) parts.push(cvJoinList(skills));
  if (skills.length > 3)
    parts.push(`${skills.slice(0, 3).join(", ")} y ${skills.length - 3} skills más`);
  const languages = after.languages.slice(before.languages.length).map((l) => l.name);
  if (languages.length > 0) parts.push(cvJoinList(languages));
  const links = (l: CvChatState["links"]) => [l.linkedin, l.github, l.portfolio].join("|");
  if (links(after.links) !== links(before.links)) parts.push("tus links");

  if (parts.length === 0) return null;
  const text = `Anoté ${cvJoinList(parts)}.`;
  return text.length <= MAX_ACK_CHARS ? text : `${text.slice(0, MAX_ACK_CHARS - 1).trimEnd()}…`;
}
