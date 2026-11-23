/**
 * Tu CV frente a una oferta (R20-03). Puro: recibe lo que la oferta pide (skills extraídas del aviso) y
 * lo que el CV ya confirmado dice, y devuelve qué está cubierto, qué falta y en qué orden conviene poner
 * las viñetas. No reescribe ninguna viñeta, no llama a un modelo y no inventa nada: o la skill aparece
 * como palabra entera, o no aparece. La oferta y el CV son datos, no instrucciones.
 */
import { err, ok, type Result } from "./result";
import { foldCvText } from "./cv-out/verify";
import type { CvHistoryInput } from "./cv-out/model";

export const CV_FOR_OFFER_LIMITS = {
  maxOfferSkills: 60,
  maxAliases: 10,
  maxCvSkills: 200,
  maxHistory: 20,
  maxBulletsPerEntry: 12,
  maxBullets: 120,
  /** Largo máximo de un texto que se mira (una skill, un alias o una viñeta). */
  maxTextChars: 400,
} as const;

export interface OfferSkillInput {
  name: string;
  aliases?: readonly string[];
  isMust: boolean;
}

export interface CvForOfferInput {
  offerSkills: readonly OfferSkillInput[];
  cvSkills: readonly string[];
  history: readonly CvHistoryInput[];
}

export interface AskedSkill {
  name: string;
  isMust: boolean;
  /** ¿Está en las skills del CV o en alguna viñeta? */
  inCv: boolean;
}

export interface RankedBullet {
  /** El texto original, sin tocar. */
  text: string;
  organization: string;
  title: string;
  /** Nombres de las skills de la oferta que la viñeta menciona, en el orden de la oferta. */
  matched: string[];
  mustMatched: number;
}

export interface CvForOffer {
  asked: AskedSkill[];
  missing: { name: string; isMust: boolean }[];
  /** Viñetas que mencionan algo de la oferta primero; después el resto, en su orden original. */
  bullets: RankedBullet[];
}

export type CvForOfferError = "sin_requisitos" | "sin_cv";

const clip = (s: string): string =>
  s.length > CV_FOR_OFFER_LIMITS.maxTextChars ? s.slice(0, CV_FOR_OFFER_LIMITS.maxTextChars) : s;

const isWordChar = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** ¿`term` (ya plegado) aparece en `text` (ya plegado) como palabra entera? Sin regex: costo lineal. */
export function cvHasWord(text: string, term: string): boolean {
  if (term.length === 0) return false;
  let from = 0;
  for (;;) {
    const at = text.indexOf(term, from);
    if (at === -1) return false;
    const before = at === 0 ? undefined : text[at - 1];
    const after = text[at + term.length];
    if (!isWordChar(before) && !isWordChar(after)) return true;
    from = at + 1;
  }
}

export function cvForOffer(input: CvForOfferInput): Result<CvForOffer, CvForOfferError> {
  const L = CV_FOR_OFFER_LIMITS;
  const terms = input.offerSkills.slice(0, L.maxOfferSkills).flatMap((s) => {
    const name = clip(s.name).trim();
    if (name === "") return [];
    const forms = [name, ...(s.aliases ?? []).slice(0, L.maxAliases).map((a) => clip(a).trim())]
      .map(foldCvText)
      .filter((f) => f !== "");
    return [{ name, isMust: s.isMust, forms: [...new Set(forms)] }];
  });
  if (terms.length === 0) return err("sin_requisitos");

  const cvSkillsFolded = input.cvSkills
    .slice(0, L.maxCvSkills)
    .map((x) => foldCvText(clip(x)).trim());

  const entries: { text: string; organization: string; title: string; folded: string }[] = [];
  for (const h of input.history.slice(0, L.maxHistory)) {
    for (const b of h.bullets.slice(0, L.maxBulletsPerEntry)) {
      if (entries.length >= L.maxBullets) break;
      if (b.trim() === "") continue;
      entries.push({
        text: b,
        organization: clip(h.organization),
        title: clip(h.title),
        folded: foldCvText(clip(b)),
      });
    }
  }
  if (entries.length === 0 && cvSkillsFolded.every((s) => s === "")) return err("sin_cv");

  const ranked = entries.map((e, index) => {
    const hits = terms.filter((t) => t.forms.some((f) => cvHasWord(e.folded, f)));
    return {
      index,
      hits,
      bullet: {
        text: e.text,
        organization: e.organization,
        title: e.title,
        matched: hits.map((t) => t.name),
        mustMatched: hits.filter((t) => t.isMust).length,
      } satisfies RankedBullet,
    };
  });

  const inBullets = new Set<string>();
  for (const r of ranked) for (const t of r.hits) inBullets.add(t.name);

  const asked: AskedSkill[] = terms.map((t) => ({
    name: t.name,
    isMust: t.isMust,
    inCv: inBullets.has(t.name) || t.forms.some((f) => cvSkillsFolded.includes(f)),
  }));

  // Estable: más requisitos obligatorios, después más coincidencias, y si empatan, el orden original
  const bullets = [...ranked]
    .sort(
      (a, b) =>
        b.bullet.mustMatched - a.bullet.mustMatched ||
        b.bullet.matched.length - a.bullet.matched.length ||
        a.index - b.index,
    )
    .map((r) => r.bullet);

  return ok({
    asked,
    missing: asked.filter((a) => !a.inCv).map((a) => ({ name: a.name, isMust: a.isMust })),
    bullets,
  });
}
