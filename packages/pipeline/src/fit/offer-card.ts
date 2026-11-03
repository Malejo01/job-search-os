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
  // Con checklist, los totales son los del checklist (`must` + `deseable`, sin las skills que el
  // aviso solo nombra): la misma cuenta que el detalle (R-3)
  const totalHave = c ? c.haveCount : have.length;
  const totalMissing = c ? c.missingCount : missing.length;

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

const REMOTE_PLACE = /^\s*(100\s*%\s*)?(remot[oa]|remote|anywhere|worldwide)(-[a-z]+)?(?![\w-])/i;

/**
 * Lo que queda del lugar después de sacarle «Remoto», «Remote (…)», etc.: «Remote - LATAM» →
 * «LATAM»; «Remoto (work from anywhere)» → nada. Así no se repite «remoto en Remoto».
 */
function placeAfterRemote(location: string): string | null {
  const rest = location
    .replace(REMOTE_PLACE, "")
    .replace(/^\s*\([^)]*\)\s*/, "")
    .replace(/^[\s\-–—:,/|·]+/, "")
    .trim();
  return rest || null;
}

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
  const raw = location?.trim() || null;
  const saysRemote = raw !== null && REMOTE_PLACE.test(raw);
  const place = saysRemote ? placeAfterRemote(raw) : raw;
  if (modality === "remoto" || saysRemote) {
    return place ? `${company}, remoto en ${place}` : `${company}, remoto`;
  }
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

type Counts = { cumple: number; no_cumple: number; no_se_sabe: number };

/**
 * Frase de cercanía arriba del detalle (D3, decisión 9): cuántos requisitos cumplís, contando
 * excluyentes y deseables, y qué falta dicho como un paso. Lo que no se puede verificar no entra
 * en la cuenta. Sin requisitos verificables, null (no se inventa un «X de Y»). Nunca promete
 * trabajo: habla de quedar más cerca, no de conseguirlo.
 */
export function closenessPhrase(checklist: {
  must: Counts;
  deseable: Counts;
  /** Lista incompleta (sin la JD entera o armada al leer): se dice (R-3). */
  parcial?: boolean;
  /** Si lo que falta frena la postulación, la frase no promete quedar entre las mejores (R-3). */
  items?: ReadonlyArray<{ status: string; bloquea: boolean }>;
}): string | null {
  const have = checklist.must.cumple + checklist.deseable.cumple;
  const missing = checklist.must.no_cumple + checklist.deseable.no_cumple;
  const total = have + missing;
  if (total === 0) return null;
  const partial = checklist.parcial === true;
  if (missing === 0) {
    const tail = partial ? ", de una lista incompleta." : ".";
    return total === 1
      ? `Cumplís el requisito que pudimos verificar${tail}`
      : `Cumplís los ${total} requisitos que pudimos verificar${tail}`;
  }
  const head = partial
    ? `Cumplís ${have} de ${total} requisitos que pudimos verificar.`
    : `Cumplís ${have} de ${total} requisitos.`;
  if (checklist.items?.some((i) => i.status === "no_cumple" && i.bloquea)) {
    return `${head} Lo que falta frena la postulación: revisalo antes de seguir.`;
  }
  return missing === 1
    ? `${head} Te falta uno para quedar entre las mejores postulaciones.`
    : `${head} Te faltan ${missing}: sumá uno y esta oferta te queda más cerca.`;
}

const MODALITY_TEXT: Record<string, string> = {
  remoto: "Remoto",
  hibrido: "Híbrido",
  presencial: "Presencial",
};

/** El texto chico de la tarjeta: «Remoto. Publicada hace 3 días». Sin modalidad, solo la fecha. */
export function offerMeta(modality: string | null, postedAt: Date, now: Date): string {
  const m = modality ? MODALITY_TEXT[modality] : undefined;
  return m ? `${m}. ${offerAge(postedAt, now)}` : offerAge(postedAt, now);
}
