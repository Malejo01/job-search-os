import type { CvDocument } from "../cv-out/model";
import { neutralizeDelimiters } from "../interview/input";
import { cvTailorRefs, cvTailorSkillItems } from "./verify";

/**
 * Variables del prompt `cv_tailor`. Todo lo que viene de afuera (oferta y CV) va en un bloque delimitado como
 * dato; el texto de la oferta o de la persona no puede cerrar el bloque. El CV que viaja al modelo no incluye
 * los datos personales de la cabecera: no hacen falta para ordenar viñetas.
 */
export const CV_TAILOR_JOB_DESCRIPTION_MAX_CHARS = 6000;
const FIELD_MAX_CHARS = 160;

// Control (salvo \n y \t), invisibles de ancho cero y de dirección; armado con una cadena para no escribirlos.
/* eslint-disable no-control-regex */
const INVISIBLE_RE = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\uFEFF]",
  "g",
);
/* eslint-enable no-control-regex */

const oneLine = (text: string, max = FIELD_MAX_CHARS): string =>
  neutralizeDelimiters(
    text
      .slice(0, max * 2)
      .replace(INVISIBLE_RE, "")
      .replace(/\s+/g, " ")
      .trim(),
  ).slice(0, max);

export interface CvTailorJob {
  title: string;
  company: string;
  description: string | null;
}

/** Bloque `<<<OFERTA>>>`. Se recorta antes de limpiar: un texto de megabytes no cuesta más que uno de 6000. */
export function prepareTailorJob(job: CvTailorJob): string {
  const raw = (job.description ?? "").slice(0, CV_TAILOR_JOB_DESCRIPTION_MAX_CHARS * 2);
  const description = neutralizeDelimiters(
    raw
      .replace(INVISIBLE_RE, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  ).slice(0, CV_TAILOR_JOB_DESCRIPTION_MAX_CHARS);
  return [
    "<<<OFERTA>>>",
    `Puesto: ${oneLine(job.title)}`,
    `Empresa: ${oneLine(job.company)}`,
    `Descripción:\n${description === "" ? "(sin descripción)" : description}`,
    "<<<FIN OFERTA>>>",
  ].join("\n");
}

/** Bloque `<<<CV>>>`: cada entrada con su referencia, sus viñetas y, al final, las skills confirmadas. */
export function prepareTailorCv(doc: CvDocument): string {
  const refs = cvTailorRefs(doc);
  const lines: string[] = ["<<<CV>>>"];
  for (const [ref, { sectionId, blockIndex }] of refs) {
    const block = doc.sections.find((s) => s.id === sectionId)!.blocks[blockIndex]!;
    const title = [block.heading, block.detail].filter((x): x is string => !!x).join(" | ");
    lines.push(`[${ref}] ${oneLine(title || sectionId, 400)}`);
    for (const bullet of block.bullets) lines.push(`- ${oneLine(bullet, 400)}`);
  }
  const skills = cvTailorSkillItems(doc).map((s) => oneLine(s, 60));
  lines.push(`Skills confirmadas: ${skills.length ? skills.join("; ") : "(ninguna)"}`);
  lines.push("<<<FIN CV>>>");
  return lines.join("\n");
}

export function buildCvTailorPromptVars(input: { cv: CvDocument; job: CvTailorJob }): {
  job: string;
  cv: string;
} {
  return { job: prepareTailorJob(input.job), cv: prepareTailorCv(input.cv) };
}
