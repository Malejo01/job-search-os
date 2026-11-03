/**
 * Tarjeta de oferta K2 (C9-8, decisión 8 de C9). Lógica pura de lo que muestra la tarjeta: los
 * chips (lo que tenés y lo que te falta), la línea de conteo, la empresa y el lugar dichos en una
 * frase y la antigüedad del aviso. Los textos del modelo no se reescriben: solo se acortan.
 */
export type OfferChip = { tone: "have" | "missing"; label: string };

export type OfferCardChecklist = {
  /** `pide` de los ítems que cumple (los primeros, en el orden del checklist). */
  have: readonly string[];
  /** `pide` de los ítems que no cumple. */
  missing: readonly string[];
  /** Totales del checklist (must + deseable). */
  haveCount: number;
  missingCount: number;
};

const MAX_CHIPS = 3;
const MAX_LABEL = 60;

const clean = (items: readonly string[]): string[] =>
  items
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.length > MAX_LABEL ? `${s.slice(0, MAX_LABEL - 1).trimEnd()}…` : s));

/**
 * Como mucho tres chips: hasta dos verdes y después los ámbar, y si sobra lugar, más verdes. Así
 * se ve lo que tenés y lo que te falta a la vez. `more` es lo que no entró («y 2 más»).
 *
 * Con checklist, los chips salen de los ítems «cumple» y «no_cumple», y hay línea de conteo
 * («4 a tu favor, 1 te falta»). Sin checklist (evaluaciones viejas), de las fortalezas y
 * debilidades de la evaluación, sin conteo.
 */
export function offerCardChips(input: {
  checklist: OfferCardChecklist | null;
  strengths: readonly string[];
  gaps: readonly string[];
}): { chips: OfferChip[]; more: number; count: string | null } {
  const c = input.checklist;
  const have = clean(c ? c.have : input.strengths);
  const missing = clean(c ? c.missing : input.gaps);
  const totalHave = c ? Math.max(c.haveCount, have.length) : have.length;
  const totalMissing = c ? Math.max(c.missingCount, missing.length) : missing.length;

  const firstHave = have.slice(0, missing.length ? 2 : MAX_CHIPS);
  const takenMissing = missing.slice(0, MAX_CHIPS - firstHave.length);
  const restHave = have.slice(
    firstHave.length,
    firstHave.length + MAX_CHIPS - firstHave.length - takenMissing.length,
  );
  const chips: OfferChip[] = [
    ...[...firstHave, ...restHave].map((label) => ({ tone: "have" as const, label })),
    ...takenMissing.map((label) => ({ tone: "missing" as const, label })),
  ];
  const more = Math.max(0, totalHave + totalMissing - chips.length);
  return { chips, more, count: c ? countLine(totalHave, totalMissing) : null };
}

function countLine(have: number, missing: number): string | null {
  const parts = [
    have > 0 ? `${have} a tu favor` : null,
    missing > 0 ? `${missing} ${missing === 1 ? "te falta" : "te faltan"}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

const REMOTE_PLACE = /^\s*(remot[oa]|remote|anywhere|worldwide|100% remot[oa])\s*$/i;

/**
 * Empresa y lugar en una frase, sin separadores: «Estudio Ruiz y Asociados, en Salta» o «Grupo
 * Norte, remoto en Argentina». Lo que el aviso no dice no se inventa: sin lugar, la empresa sola.
 */
export function offerPlace({
  company,
  location,
  modality,
}: {
  company: string;
  location: string | null;
  modality: string | null;
}): string {
  const place = location?.trim() && !REMOTE_PLACE.test(location) ? location.trim() : null;
  if (modality === "remoto") return place ? `${company}, remoto en ${place}` : `${company}, remoto`;
  return place ? `${company}, en ${place}` : company;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Antigüedad del aviso, en texto chico: «Publicada hoy», «hace 4 días», «hace 2 semanas». */
export function offerAge(postedAt: Date, now: Date): string {
  const days = Math.max(0, Math.floor((now.getTime() - postedAt.getTime()) / DAY_MS));
  if (days === 0) return "Publicada hoy";
  if (days === 1) return "Publicada ayer";
  if (days < 14) return `Publicada hace ${days} días`;
  if (days <= 31) return `Publicada hace ${Math.floor(days / 7)} semanas`;
  return "Publicada hace más de un mes";
}
