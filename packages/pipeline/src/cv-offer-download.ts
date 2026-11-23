/**
 * Descarga del CV para una oferta (R20-05). Puro: el nombre del archivo y el reordenado de viñetas.
 * El reordenado no reescribe nada: solo cambia el orden dentro de cada bloque, estable.
 */
import { cvHasWord, type OfferSkillInput } from "./cv-for-offer";
import type { CvDocument } from "./cv-out/model";
import { foldCvText } from "./cv-out/verify";

const PART_MAX = 40;
/** Se mira solo el comienzo del texto: el resto no entra en un nombre de archivo. */
const INPUT_MAX = 400;

/** Conserva las mayúsculas del original: se sanea sobre el texto ya sin tildes. */
function cleanPart(raw: string): string {
  const stripped = raw.slice(0, INPUT_MAX).normalize("NFD").replace(/\p{M}/gu, "");
  return stripped
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, PART_MAX)
    .replace(/-+$/g, "");
}

/** `CV-<puesto>-<empresa>.docx`: solo letras sin tilde, números y guiones; `CV.docx` si no queda nada. */
export function cvOfferFileName(title: string, company: string): string {
  const parts = [cleanPart(title), cleanPart(company)].filter((p) => p !== "");
  return `${["CV", ...parts].join("-")}.docx`;
}

/** Copia del CV con las viñetas de cada bloque ordenadas por coincidencia con la oferta (estable). */
export function reorderCvBullets(
  doc: CvDocument,
  offerSkills: readonly OfferSkillInput[],
): CvDocument {
  const terms = offerSkills.slice(0, 60).map((s) => ({
    isMust: s.isMust,
    forms: [s.name, ...(s.aliases ?? []).slice(0, 10)]
      .map((f) => foldCvText(f.slice(0, 400)).trim())
      .filter((f) => f !== ""),
  }));
  const score = (bullet: string): [number, number] => {
    const folded = foldCvText(bullet.slice(0, 400));
    const hits = terms.filter((t) => t.forms.some((f) => cvHasWord(folded, f)));
    return [hits.filter((t) => t.isMust).length, hits.length];
  };
  return {
    ...doc,
    sections: doc.sections.map((sec) => ({
      ...sec,
      blocks: sec.blocks.map((b) => {
        if (terms.length === 0 || b.bullets.length < 2) return { ...b, bullets: [...b.bullets] };
        const bullets = b.bullets
          .map((text, i) => ({ text, i, s: score(text) }))
          .sort((x, y) => y.s[0] - x.s[0] || y.s[1] - x.s[1] || x.i - y.i)
          .map((x) => x.text);
        return { ...b, bullets };
      }),
    })),
  };
}
