import {
  CV_BULLET_MAX_CHARS,
  cleanCvText,
  cvRejectReasons,
  foldCvText,
  hasLinkOrEmail,
  type CvRejectReason,
} from "../cv-out/verify";
import type { CvDocument, CvSection, CvSectionId } from "../cv-out/model";
import { err, ok, type Result } from "../result";
import { CvTailorOutputSchema, type CvTailorChange, CV_TAILOR_MAX_CHANGES } from "./schemas";

/**
 * Verificador de la versión adaptada (R20-04). Puro. El modelo evalúa, el código decide: lo que propone el modelo
 * entra al CV solo si cada pieza se explica con el CV confirmado. Si algo no cierra (un número, una empresa, una
 * tecnología o una skill que el CV no tenía, una entrada que no existe, una viñeta con link) se descarta la
 * versión entera y quien llama cae a la versión por código.
 *
 * Qué puede cambiar la versión adaptada: las viñetas de cada entrada (orden, cuáles van y, con las mismas
 * palabras y datos, su redacción) y el orden de las skills dentro de cada grupo. Qué no puede cambiar: nombre,
 * contacto, idioma, faltantes, títulos de sección, cargos, empresas, fechas, ni qué skills hay. Eso sale del CV
 * original, no de la salida del modelo.
 */

/** Secciones cuyas entradas llevan viñetas y por lo tanto tienen referencia (`experience-0`, `projects-1`…). */
const REF_SECTIONS: readonly CvSectionId[] = [
  "experience",
  "projects",
  "education",
  "certifications",
  "achievements",
];

export type CvTailorRef = { sectionId: CvSectionId; blockIndex: number };

/** Referencias de las entradas editables, en el orden del CV. El mismo orden y formato que ve el modelo. */
export function cvTailorRefs(doc: CvDocument): Map<string, CvTailorRef> {
  const refs = new Map<string, CvTailorRef>();
  for (const section of doc.sections) {
    if (!REF_SECTIONS.includes(section.id)) continue;
    section.blocks.forEach((_, blockIndex) => {
      refs.set(`${section.id}-${blockIndex}`, { sectionId: section.id, blockIndex });
    });
  }
  return refs;
}

/** `Datos: SQL, Excel` → `{ label: "Datos", items: ["SQL", "Excel"] }`; sin grupo, `label` es null. */
export function parseSkillBlock(detail: string | null): { label: string | null; items: string[] } {
  const text = (detail ?? "").trim();
  if (text === "") return { label: null, items: [] };
  const hit = /^([^:,]{1,40}): (.+)$/su.exec(text);
  const label = hit ? hit[1]! : null;
  const rest = hit ? hit[2]! : text;
  return {
    label,
    items: rest
      .split(", ")
      .map((x) => x.trim())
      .filter((x) => x !== ""),
  };
}

/** Todas las skills del CV, en el orden en que salen. */
export function cvTailorSkillItems(doc: CvDocument): string[] {
  const skills = doc.sections.find((s) => s.id === "skills");
  return (skills?.blocks ?? []).flatMap((b) => parseSkillBlock(b.detail).items);
}

export type CvTailorRejectReason =
  | "invalid_output"
  | "unknown_ref"
  | "duplicate_ref"
  | "too_many_bullets"
  | "empty_entry"
  | "bullet_rejected"
  | "skill_not_in_cv";

export interface CvTailorRejection {
  reason: CvTailorRejectReason;
  /** Entrada donde falló, si aplica. */
  ref?: string;
  /** Motivos del verificador de texto, si aplica. Nunca el texto del modelo. */
  detail?: CvRejectReason[];
}

export interface CvTailorVerified {
  /** El CV adaptado: lo del CV original con las viñetas y el orden de skills ya verificados. */
  document: CvDocument;
  /** Qué cambió y por qué, ya limpio (sin links, con tope). */
  changes: CvTailorChange[];
  /** `false` si la versión quedó idéntica al CV original. */
  changed: boolean;
}

export interface CvTailorVerifyOptions {
  /** Nombres de skills conocidos (catálogo): si aparecen en una viñeta nueva, tienen que estar en su entrada. */
  knownTerms?: readonly string[];
}

const same = (a: string, b: string): boolean => foldCvText(a).trim() === foldCvText(b).trim();

/**
 * Compara la salida del modelo con el CV original. `output` puede venir del navegador (la descarga lo vuelve a
 * mandar): se valida con el esquema estricto y se verifica de nuevo, así que no hace falta confiar en quien lo trae.
 */
export function verifyCvTailor(
  original: CvDocument,
  output: unknown,
  opts: CvTailorVerifyOptions = {},
): Result<CvTailorVerified, CvTailorRejection> {
  const parsed = CvTailorOutputSchema.safeParse(output);
  if (!parsed.success) return err({ reason: "invalid_output" });
  const { entries, skills, changes } = parsed.data;

  const refs = cvTailorRefs(original);
  const proposed = new Map<string, string[]>();
  for (const entry of entries) {
    if (!refs.has(entry.ref)) return err({ reason: "unknown_ref", ref: entry.ref });
    if (proposed.has(entry.ref)) return err({ reason: "duplicate_ref", ref: entry.ref });
    proposed.set(entry.ref, entry.bullets);
  }

  // Skills: ninguna nueva; el orden del modelo manda dentro de cada grupo
  const own = cvTailorSkillItems(original);
  const rank = new Map<string, number>();
  for (const name of skills) {
    if (!own.some((o) => same(o, name))) return err({ reason: "skill_not_in_cv" });
    const key = foldCvText(name).trim();
    if (!rank.has(key)) rank.set(key, rank.size);
  }

  const sections: CvSection[] = [];
  for (const section of original.sections) {
    if (section.id === "skills") {
      sections.push({
        ...section,
        blocks: section.blocks.map((block) => {
          const { label, items } = parseSkillBlock(block.detail);
          if (items.length === 0 || rank.size === 0) return block;
          const sorted = items
            .map((item, index) => ({ item, index, r: rank.get(foldCvText(item).trim()) }))
            .sort((a, b) => (a.r ?? Infinity) - (b.r ?? Infinity) || a.index - b.index)
            .map((x) => x.item);
          return { ...block, detail: `${label ? `${label}: ` : ""}${sorted.join(", ")}` };
        }),
      });
      continue;
    }
    if (!REF_SECTIONS.includes(section.id)) {
      sections.push(section);
      continue;
    }
    const blocks = [];
    for (const [blockIndex, block] of section.blocks.entries()) {
      const ref = `${section.id}-${blockIndex}`;
      const candidate = proposed.get(ref);
      if (candidate === undefined) {
        blocks.push(block);
        continue;
      }
      if (candidate.length > block.bullets.length) {
        return err({ reason: "too_many_bullets", ref });
      }
      if (candidate.length === 0 && block.bullets.length > 0) {
        return err({ reason: "empty_entry", ref });
      }
      // Fuentes: solo esta entrada. Una tecnología que el CV lista aparte no se le puede atribuir a otro puesto.
      const sources = [block.heading ?? "", block.detail ?? "", ...block.bullets].filter(
        (x) => x !== "",
      );
      const out: string[] = [];
      for (const raw of candidate) {
        const verbatim = block.bullets.find((b) => same(b, raw));
        if (verbatim !== undefined) {
          if (!out.some((o) => same(o, verbatim))) out.push(verbatim);
          continue;
        }
        const reasons = cvRejectReasons(raw, sources, {
          maxChars: CV_BULLET_MAX_CHARS,
          ...(opts.knownTerms ? { knownTerms: opts.knownTerms } : {}),
        });
        if (reasons.length > 0) return err({ reason: "bullet_rejected", ref, detail: reasons });
        const text = cleanCvText(raw, CV_BULLET_MAX_CHARS);
        if (text !== "" && !out.some((o) => same(o, text))) out.push(text);
      }
      blocks.push({ ...block, bullets: out });
    }
    sections.push({ ...section, blocks });
  }

  const cleanChanges: CvTailorChange[] = [];
  for (const c of changes) {
    if (hasLinkOrEmail(c.what) || hasLinkOrEmail(c.why)) continue;
    const what = cleanCvText(c.what, 160, true);
    const why = cleanCvText(c.why, 240, true);
    if (what !== "" && why !== "") cleanChanges.push({ what, why });
    if (cleanChanges.length >= CV_TAILOR_MAX_CHANGES) break;
  }

  const document: CvDocument = { ...original, sections };
  return ok({
    document,
    changes: cleanChanges,
    changed: JSON.stringify(document) !== JSON.stringify(original),
  });
}
