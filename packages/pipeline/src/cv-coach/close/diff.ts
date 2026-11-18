/**
 * «Qué mejoró» del coach de CV (ADR-038 §8, R12-11). Puro: compara la foto «antes» (`jso:coach:before`, las
 * filas confirmadas al empezar el coach) con lo que está hoy en la base, y reparte los problemas del
 * diagnóstico en resueltos, salteados y abiertos según el avance de la charla.
 *
 * - Sin la foto (o si es de otra charla), solo los problemas: no hay con qué comparar.
 * - Nunca muestra texto que no esté en la base o en la foto: las viñetas, los títulos y las organizaciones
 *   salen de una de las dos; una cita del diagnóstico se muestra solo si es substring normalizado del ítem
 *   (antes o después). La lista de problemas y el avance vienen del navegador: se usan los ids, nada más.
 */
import { foldCvText } from "../../cv-out/verify";
import type { CvCoachBefore, CvIssue } from "../schemas";

/** Un ítem confirmado, con la forma de la foto «antes». */
export type CvDiffItem = CvCoachBefore["items"][number];

export type CvDiffStatus = "changed" | "new" | "removed" | "same";

export type CvDiffEntry = {
  historyId: string;
  kind: CvDiffItem["kind"];
  organization: string;
  title: string;
  /** Viñetas de la foto (vacío si el ítem es nuevo). */
  before: string[];
  /** Viñetas de hoy (vacío si el ítem ya no está). */
  after: string[];
  added: string[];
  removed: string[];
  status: CvDiffStatus;
};

export type CvDiff = {
  hasBefore: boolean;
  /** Ítems lado a lado: primero los que cambiaron, después los nuevos, los quitados y los iguales. */
  items: CvDiffEntry[];
  issues: { resolved: CvIssue[]; skipped: CvIssue[]; open: CvIssue[] };
};

export type CvDiffInput = {
  /** `flowId` de la charla: la foto de otra charla no cuenta. */
  flowId: string;
  before: CvCoachBefore | null;
  /** Lo confirmado hoy, leído con RLS. */
  after: readonly CvDiffItem[];
  issues: readonly CvIssue[];
  progress: { resolved: readonly string[]; skipped: readonly string[] };
};

const fold = (s: string) => foldCvText(s).replace(/\s+/g, " ").trim();
const STATUS_ORDER: Record<CvDiffStatus, number> = { changed: 0, new: 1, removed: 2, same: 3 };

function texts(item: CvDiffItem | undefined): string[] {
  return item ? [item.organization, item.title, ...item.bullets] : [];
}

function entry(b: CvDiffItem | undefined, a: CvDiffItem | undefined): CvDiffEntry {
  const base = (a ?? b)!;
  const before = b ? [...b.bullets] : [];
  const after = a ? [...a.bullets] : [];
  const beforeSet = new Set(before.map(fold));
  const afterSet = new Set(after.map(fold));
  const added = after.filter((x) => !beforeSet.has(fold(x)));
  const removed = before.filter((x) => !afterSet.has(fold(x)));
  const status: CvDiffStatus = !b
    ? "new"
    : !a
      ? "removed"
      : added.length > 0 ||
          removed.length > 0 ||
          fold(a.title) !== fold(b.title) ||
          fold(a.organization) !== fold(b.organization)
        ? "changed"
        : "same";
  return {
    historyId: base.historyId,
    kind: base.kind,
    // de la base si el ítem sigue; si no, de la foto
    organization: base.organization,
    title: base.title,
    before,
    after,
    added,
    removed,
    status,
  };
}

export function diffCv(input: CvDiffInput): CvDiff {
  const before = input.before && input.before.flowId === input.flowId ? input.before : null;
  const beforeById = new Map((before?.items ?? []).map((i) => [i.historyId, i]));
  const afterById = new Map(input.after.map((i) => [i.historyId, i]));

  const items: CvDiffEntry[] = [];
  if (before) {
    for (const a of input.after) items.push(entry(beforeById.get(a.historyId), a));
    for (const b of before.items) if (!afterById.has(b.historyId)) items.push(entry(b, undefined));
    items.sort((x, y) => STATUS_ORDER[x.status] - STATUS_ORDER[y.status]);
  }

  // Citas: solo si están en el ítem (antes o después); si no, el problema se muestra sin cita
  const safe = (i: CvIssue): CvIssue => {
    if (i.quote === null) return i;
    const id = i.ref.itemId;
    const pool = id === null ? [] : [...texts(beforeById.get(id)), ...texts(afterById.get(id))];
    const q = fold(i.quote);
    const shown = i.quote.replace(/\s+/g, " ").trim();
    return { ...i, quote: q.length > 0 && pool.some((t) => fold(t).includes(q)) ? shown : null };
  };

  const resolved = new Set(input.progress.resolved);
  const skipped = new Set(input.progress.skipped);
  const out: CvDiff["issues"] = { resolved: [], skipped: [], open: [] };
  for (const i of input.issues.map(safe)) {
    if (resolved.has(i.id)) out.resolved.push(i);
    else if (skipped.has(i.id)) out.skipped.push(i);
    else out.open.push(i);
  }
  return { hasBefore: before !== null, items, issues: out };
}
