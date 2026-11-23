import { z } from "zod";
import { cvTailorRefs } from "./verify";
import type { CvDocument } from "../cv-out/model";
import { err, ok, type Result } from "../result";

/**
 * Golden de la versión adaptada (`cv_tailor`, R20-04): 8 casos inventados (un CV, una oferta y lo que se espera).
 * Lógica pura: el harness de `evals/` carga el archivo, llama al modelo, pasa la salida por `verifyCvTailor` y usa
 * esto para puntuar. Se informan siempre cuatro números: **estricta** (versión aceptada, limpia y con la viñeta
 * esperada primera), **laxa** (aceptada, limpia y con la viñeta esperada entre las dos primeras), **descartadas**
 * (la verificación las tiró: la persona habría visto la versión sin IA) e **inseguras** (aceptadas pero con un
 * dato prohibido; tiene que dar 0, porque la verificación existe para eso).
 */
export const CV_TAILOR_GOLDEN_SIZE = 8;
export const CV_TAILOR_LAX_POSITION = 2;

const SkillSchema = z.object({
  name: z.string().min(1),
  category: z.string().nullable().optional(),
});
const HistorySchema = z.object({
  kind: z.enum(["trabajo", "educacion", "certificacion", "proyecto"]),
  organization: z.string(),
  title: z.string(),
  startMonth: z.string().nullable(),
  endMonth: z.string().nullable(),
  bullets: z.array(z.string()),
  link: z.string().nullable().optional(),
});

export const CvTailorGoldenCaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  cv: z.object({
    displayName: z.string(),
    email: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    headline: z.string().nullable().optional(),
    summary: z.string().nullable().optional(),
    skills: z.array(SkillSchema),
    languages: z.array(z.object({ name: z.string(), level: z.string().nullable().optional() })),
    achievements: z.array(z.string()),
    history: z.array(HistorySchema),
  }),
  job: z.object({ title: z.string().min(1), company: z.string(), description: z.string().min(1) }),
  expect: z.object({
    /** Textos que no pueden aparecer en el CV adaptado (herramientas, cifras o nombres que solo trae la oferta). */
    forbidden: z.array(z.string().min(1)).optional(),
    /** Entrada y fragmento de la viñeta que tiene que quedar primera. */
    firstBullet: z.object({ ref: z.string().min(1), contains: z.string().min(1) }).optional(),
    /** Las dos skills que tienen que quedar al frente de su grupo (en cualquier orden). */
    firstSkills: z.array(z.string().min(1)).max(3).optional(),
  }),
  notes: z.string().optional(),
});
export type CvTailorGoldenCase = z.infer<typeof CvTailorGoldenCaseSchema>;
export type CvTailorGoldenExpect = CvTailorGoldenCase["expect"];

export function parseCvTailorGolden(raw: unknown): Result<CvTailorGoldenCase[], string> {
  const parsed = z.array(CvTailorGoldenCaseSchema).safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return err(`golden inválido: ${first?.path.join(".") ?? ""} ${first?.message ?? ""}`.trim());
  }
  const ids = parsed.data.map((c) => c.id);
  if (new Set(ids).size !== ids.length) return err("golden inválido: ids repetidos");
  if (parsed.data.length !== CV_TAILOR_GOLDEN_SIZE) {
    return err(
      `golden inválido: se esperaban ${CV_TAILOR_GOLDEN_SIZE} casos y hay ${parsed.data.length}`,
    );
  }
  return ok(parsed.data);
}

export interface CvTailorCaseCheck {
  /** La verificación descartó la versión (cae a la versión sin IA). */
  rejected: boolean;
  /** Aceptada pero con un dato prohibido. Tiene que ser siempre `false`. */
  unsafe: boolean;
  strict: boolean;
  lax: boolean;
  failures: string[];
}

const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Todo el texto del CV adaptado (sin las explicaciones de `changes`, que sí pueden nombrar lo que pide la oferta). */
function documentText(doc: CvDocument): string {
  return doc.sections
    .flatMap((s) => s.blocks.flatMap((b) => [b.heading ?? "", b.detail ?? "", ...b.bullets]))
    .join("\n");
}

/** Puntúa una versión ya verificada (`null` si la verificación la descartó) contra lo esperado del caso. */
export function checkCvTailorCase(
  expected: CvTailorGoldenExpect,
  doc: CvDocument | null,
): CvTailorCaseCheck {
  if (doc === null) {
    return {
      rejected: true,
      unsafe: false,
      strict: false,
      lax: false,
      failures: ["la verificación descartó la versión"],
    };
  }
  const failures: string[] = [];
  const text = fold(documentText(doc));
  const hits = (expected.forbidden ?? []).filter((f) => text.includes(fold(f)));
  for (const h of hits) failures.push(`aparece «${h}», que el CV no tenía`);

  let position: number | null = null;
  if (expected.firstBullet) {
    const hit = cvTailorRefs(doc).get(expected.firstBullet.ref);
    const bullets = hit
      ? (doc.sections.find((s) => s.id === hit.sectionId)?.blocks[hit.blockIndex]?.bullets ?? [])
      : [];
    const idx = bullets.findIndex((b) => fold(b).includes(fold(expected.firstBullet!.contains)));
    position = idx < 0 ? null : idx;
    if (position === null) failures.push("la viñeta esperada no está");
    else if (position > 0) failures.push(`la viñeta esperada quedó en el puesto ${position + 1}`);
  }
  let skillsOk = true;
  if (expected.firstSkills && expected.firstSkills.length > 0) {
    const line = fold(
      doc.sections.find((s) => s.id === "skills")?.blocks.map((b) => b.detail ?? "")[0] ?? "",
    );
    const list = line.replace(/^[^:,]{1,40}: /u, "").split(", ");
    const front = list.slice(0, expected.firstSkills.length);
    skillsOk = expected.firstSkills.every((s) => front.includes(fold(s)));
    if (!skillsOk) failures.push("las skills esperadas no quedaron al frente");
  }

  const clean = hits.length === 0;
  const orderStrict = (expected.firstBullet ? position === 0 : true) && skillsOk;
  const orderLax =
    (expected.firstBullet ? position !== null && position < CV_TAILOR_LAX_POSITION : true) &&
    skillsOk;
  return {
    rejected: false,
    unsafe: !clean,
    strict: clean && orderStrict,
    lax: clean && orderLax,
    failures,
  };
}

export function summarizeCvTailorChecks(checks: readonly CvTailorCaseCheck[]): {
  n: number;
  strict: number;
  lax: number;
  rejected: number;
  unsafe: number;
  strictRate: number | null;
  laxRate: number | null;
} {
  const n = checks.length;
  const count = (f: (c: CvTailorCaseCheck) => boolean) => checks.filter(f).length;
  const strict = count((c) => c.strict);
  const lax = count((c) => c.lax);
  return {
    n,
    strict,
    lax,
    rejected: count((c) => c.rejected),
    unsafe: count((c) => c.unsafe),
    strictRate: n === 0 ? null : strict / n,
    laxRate: n === 0 ? null : lax / n,
  };
}
