/**
 * Redacción del CV (C-25, tarea `cv_write`): la IA pasa lo que dijo la persona a viñetas ATS y a un resumen,
 * pero nada del modelo llega al CV sin pasar por el verificador. Puro: acá se arman las variables del
 * prompt y se aplica la salida; la llamada al modelo vive en `adapters`.
 */
import { z } from "zod";
import {
  cleanCvText,
  CV_SUMMARY_MAX_CHARS,
  verifyCvBullets,
  verifyCvSummary,
  type CvRejectReason,
} from "../cv-out/verify";
import type { CvHistoryInput, CvLang } from "../cv-out/model";

export const CV_WRITE_OUTPUT_SCHEMA = z.strictObject({
  summary: z.string().max(CV_SUMMARY_MAX_CHARS * 2),
  entries: z
    .array(z.strictObject({ id: z.string().max(20), bullets: z.array(z.string().max(500)).max(8) }))
    .max(20),
});
export type CvWriteOutput = z.infer<typeof CV_WRITE_OUTPUT_SCHEMA>;

export interface CvWriteInput {
  lang: CvLang;
  target: string | null;
  /** Historial confirmado; las viñetas de cada trabajo son el texto de la persona. */
  history: readonly CvHistoryInput[];
  skills: readonly string[];
  languages: readonly string[];
}

const entryId = (i: number): string => `h${i}`;

/** Variables del prompt `cv_write`: solo trabajos con sus respuestas, y el contexto para el resumen. */
export function cvWriteVars(input: CvWriteInput): Record<string, string> {
  const works = input.history.flatMap((h, i) =>
    h.kind === "trabajo"
      ? [{ id: entryId(i), organization: h.organization, title: h.title, answers: h.bullets }]
      : [],
  );
  const studies = input.history
    .filter((h) => h.kind !== "trabajo")
    .map((h) => ({ organization: h.organization, title: h.title }));
  return {
    lang: input.lang,
    target: input.target ?? "",
    works: JSON.stringify(works),
    context: JSON.stringify({ studies, skills: input.skills, languages: input.languages }),
  };
}

export interface CvWriteStats {
  bullets: number;
  fromModel: number;
  fromPerson: number;
  rejected: Partial<Record<CvRejectReason, number>>;
  summary: "model" | "none";
}

export interface CvWriteResult {
  history: CvHistoryInput[];
  /** Resumen verificado; null si el modelo no lo trajo o el verificador lo descartó (no se inventa uno). */
  summary: string | null;
  stats: CvWriteStats;
}

/**
 * Aplica la salida del modelo: cada viñeta se compara con lo que la persona dijo de ese trabajo. Si trae un
 * número, un nombre o una tecnología que no estaba, se descarta y queda el texto de la persona. Ids
 * desconocidos se ignoran; un trabajo sin viñetas verificadas conserva las de la persona.
 */
export function applyCvWrite(
  input: CvWriteInput,
  output: CvWriteOutput,
  opts: { knownTerms?: readonly string[] } = {},
): CvWriteResult {
  const stats: CvWriteStats = {
    bullets: 0,
    fromModel: 0,
    fromPerson: 0,
    rejected: {},
    summary: "none",
  };
  const byId = new Map(output.entries.map((e) => [e.id, e.bullets]));
  const verifyOpts = opts.knownTerms ? { knownTerms: opts.knownTerms } : {};

  const history = input.history.map((h, i): CvHistoryInput => {
    if (h.kind !== "trabajo") return h;
    const person = h.bullets;
    const generated = byId.get(entryId(i));
    if (!generated || generated.length === 0) return h;
    const sources = [h.organization, h.title, ...person];
    const pairs = generated.map((g, j) => ({ generated: g, person: person[j] ?? "" }));
    const verified = verifyCvBullets(pairs, sources, verifyOpts);
    for (const v of verified) {
      stats.bullets++;
      if (v.origin === "generated") stats.fromModel++;
      else stats.fromPerson++;
      for (const r of v.rejected) stats.rejected[r] = (stats.rejected[r] ?? 0) + 1;
    }
    const bullets = verified.length > 0 ? verified.map((v) => v.text) : person;
    return { ...h, bullets };
  });

  const personAll = input.history.flatMap((h) => [h.organization, h.title, ...h.bullets]);
  const summarySources = [
    ...(input.target ? [input.target] : []),
    ...personAll,
    ...input.skills,
    ...input.languages,
  ];
  let summary: string | null = null;
  if (output.summary.trim() !== "") {
    const v = verifyCvSummary(output.summary, summarySources, "", verifyOpts);
    if (v.origin === "generated") {
      summary = cleanCvText(v.text, CV_SUMMARY_MAX_CHARS);
      stats.summary = "model";
    }
  }
  return { history, summary, stats };
}
