import { z } from "zod";
import { cvProjectLink } from "../cv-out/model";
import { CV_BULLET_MAX_CHARS, foldCvText, hasLinkOrEmail } from "../cv-out/verify";
import { CEFR_LEVELS } from "../onboarding";
import { err, ok, type Result } from "../result";
import { compileTaxonomy, extractSkillsFromText } from "../skills/match";
import { isRoleKey, type RoleKey } from "../skills/self-assessment";
import type { CvCandidate } from "./candidates";
import { detectCvInjection } from "./injection";
import { CV_MAX_SUMMARY_CHARS, CV_MIN_SUMMARY_CHARS } from "./limits";
import { findCvSensitive, stripCvUrls, type CvRedactionKind } from "./redact";
import { cvVerbatim } from "./verbatim";

const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Topes de la lectura v2 (R12-5): viñetas por trabajo o proyecto y términos del stack. */
export const CV_READ_MAX_BULLETS = 6;
export const CV_READ_MAX_PROJECTS = 10;
export const CV_READ_MAX_STACK = 12;

// Viñetas que propone el modelo: el esquema es generoso (una de más no rompe la lectura entera) y el
// código las recorta y verifica contra el texto (ADR-038 §7, D4). `default([])`: la salida del prompt v1
// no las trae y sigue siendo válida.
const modelBullets = z.array(z.string().max(500)).max(10).default([]);

/**
 * Esquema de la salida del modelo. `.strict()` en todos los objetos: una clave de más
 * (`birth_date`, `photo`, `religion`, `health`, `marital_status`, `dni`) hace fallar el esquema,
 * y así se "prohíben" los datos sensibles que no se pueden sacar con reglas.
 */
export const cvExtractionSchema = z
  .object({
    profile: z
      .object({
        target_title: z.string().max(120).nullable(),
        years_total: z.number().min(0).max(60).nullable(),
        english_cefr: z.enum(CEFR_LEVELS).nullable(),
        location_country: z
          .string()
          .regex(/^[A-Z]{2}$/)
          .nullable(), // ISO-2, sin ciudad exacta ni dirección
        location_city: z.string().max(80).nullable(),
        summary: z.string().max(2400).nullable(),
      })
      .strict(),
    skills: z
      .array(
        z
          .object({
            slug: z.string().max(80),
            level: z.number().int().min(1).max(3),
            years: z.number().min(0).max(45).nullable(),
          })
          .strict(),
      )
      .max(60),
    facts: z
      .array(
        z
          .object({
            text: z.string().max(300),
            kind: z.enum(["proyecto", "logro", "metrica"]),
          })
          .strict(),
      )
      .max(20),
    work_history: z
      .array(
        z
          .object({
            company: z.string().max(120),
            title: z.string().max(120),
            start: z.string().regex(YEAR_MONTH).nullable(), // AAAA-MM
            end: z.string().regex(YEAR_MONTH).nullable(), // null = actual o no dice
            bullets: modelBullets, // v2: viñetas tal cual las escribe el CV
          })
          .strict(),
      )
      .max(20),
    // v2 (R12-5, ADR-038 §6 y §7): proyectos con rol, link y stack. `default([])` como estudios e idiomas.
    projects: z
      .array(
        z
          .object({
            name: z.string().max(120),
            role: z.string().max(120).nullable(),
            link: z.string().max(300).nullable(),
            stack: z.array(z.string().max(80)).max(20),
            start: z.string().regex(YEAR_MONTH).nullable(),
            end: z.string().regex(YEAR_MONTH).nullable(),
            bullets: modelBullets,
          })
          .strict(),
      )
      .max(CV_READ_MAX_PROJECTS)
      .default([]),
    // ADR-034 §8: estudios e idiomas para las tarjetas del agente de perfil. `default([])`: una salida
    // sin estas claves (el prompt de antes) sigue siendo válida y no inventa nada.
    education: z
      .array(
        z
          .object({
            institution: z.string().max(120),
            title: z.string().max(120),
            start: z.string().regex(YEAR_MONTH).nullable(), // AAAA-MM
            end: z.string().regex(YEAR_MONTH).nullable(),
          })
          .strict(),
      )
      .max(10)
      .default([]),
    languages: z
      .array(
        z
          .object({
            name: z.string().max(40),
            level: z.string().max(30).nullable(), // tal como lo dice el CV ("C1", "Nativo"); null si no dice
          })
          .strict(),
      )
      .max(8)
      .default([]),
    suggested_roles: z.array(z.string().max(40)).max(3),
    other_terms: z.array(z.string().max(60)).max(20),
  })
  .strict();
export type CvExtraction = z.infer<typeof cvExtractionSchema>;

export type CvDropReason =
  | "skill_not_candidate"
  | "fact_sensitive"
  | "work_dates_invalid"
  | "project_dates_invalid"
  | "bullet_not_in_cv"
  | "bullet_sensitive"
  | "bullet_too_long"
  | "stack_not_in_cv"
  | "education_dates_invalid"
  | "language_invalid"
  | "role_unknown"
  | "term_url"
  | "term_sensitive"
  | "injection";
export type CvExtractionError = "schema_invalid" | "sensitive_output";

export type CvProposal = {
  profile: CvExtraction["profile"];
  skills: { slug: string; level: 1 | 2 | 3 | null; years: number | null; verified: boolean }[];
  facts: { text: string; kind: "proyecto" | "logro" | "metrica"; source: "autodeclarado" }[];
  workHistory: {
    company: string;
    title: string;
    start: string | null;
    end: string | null;
    /** Viñetas literales del CV (substring normalizado del texto leído), nunca del modelo. */
    bullets: string[];
  }[];
  /** Proyectos (D2): `link` solo si es https y está literal en el texto leído; `stack` solo lo que el CV nombra. */
  projects: {
    name: string;
    role: string | null;
    link: string | null;
    stack: string[];
    start: string | null;
    end: string | null;
    bullets: string[];
  }[];
  education: { institution: string; title: string; start: string | null; end: string | null }[];
  languages: { name: string; level: string | null }[];
  suggestedRoles: RoleKey[];
  otherTerms: string[];
  flags: { summaryInjection: boolean; dropped: Partial<Record<CvDropReason, number>> };
};

/** Datos que no pueden volver en el resumen, los hechos ni el historial. */
const OUTPUT_FORBIDDEN: ReadonlySet<CvRedactionKind> = new Set([
  "birth_date",
  "age",
  "national_id",
  "passport",
  "email",
  "phone",
  "address",
]);

const SUGGESTED_ROLES_MAX = 2;

const hasForbidden = (text: string | null): boolean =>
  text !== null && findCvSensitive(text).some((k) => OUTPUT_FORBIDDEN.has(k));

// Marcadores que deja `redactCvText` («[link]», «[email]», «[teléfono]»): una viñeta con uno no se propone
const REDACTION_MARKER_RE = /\[[\p{L} ]{3,20}\]/u;

/** ¿El término aparece en el texto como palabra suelta, sin mayúsculas ni acentos? */
function termInText(foldedText: string, term: string): boolean {
  const f = foldCvText(term).trim();
  if (f.length < 1) return false;
  const esc = f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "u").test(foldedText);
}

/** El código de nivel solo vale si aparece a menos de 60 caracteres de "inglés"/"english". */
function cefrHasEvidence(code: string, text: string): boolean {
  const re = new RegExp(`(?<![A-Za-z0-9])${code}(?![A-Za-z0-9])`, "gi");
  for (const m of text.matchAll(re)) {
    const from = Math.max(0, m.index - 60);
    const window = text.slice(from, m.index + code.length + 60);
    if (/ingl|english/i.test(window)) return true;
  }
  return false;
}

/** Cota de años de experiencia: del año de 4 cifras más antiguo del texto al actual, inclusive. */
function maxYearsFromText(text: string, todayYear: number): number | null {
  let oldest: number | null = null;
  for (const m of text.matchAll(/(?<!\d)(19[5-9]\d|20\d{2})(?!\d)/g)) {
    const y = Number.parseInt(m[1]!, 10);
    if (y <= todayYear && (oldest === null || y < oldest)) oldest = y;
  }
  return oldest === null ? null : todayYear - oldest + 1;
}

function cleanSummary(summary: string): string | null {
  let s = stripCvUrls(summary)
    .replace(/[^\S\n]+/g, " ")
    .trim();
  if (s.length > CV_MAX_SUMMARY_CHARS) {
    const cut = s.slice(0, CV_MAX_SUMMARY_CHARS);
    const dot = cut.lastIndexOf(".");
    s = dot > 0 ? cut.slice(0, dot + 1) : cut;
  }
  return s.length < CV_MIN_SUMMARY_CHARS ? null : s;
}

/**
 * Valida y limpia lo que devolvió el modelo. Nada se completa: lo que el modelo no devolvió, o que el
 * CV no respalda, queda `null`. El modelo propone, este código decide.
 */
export function normalizeCvExtraction(
  raw: unknown,
  ctx: { text: string; candidates: readonly CvCandidate[]; today: string },
): Result<CvProposal, CvExtractionError> {
  const parsed = cvExtractionSchema.safeParse(raw);
  if (!parsed.success) return err("schema_invalid");
  const data = parsed.data;

  const texts = [
    data.profile.target_title,
    data.profile.location_city,
    data.profile.summary,
    ...data.facts.map((f) => f.text),
    ...data.work_history.flatMap((w) => [w.company, w.title]),
    ...data.projects.flatMap((p) => [p.name, p.role]),
    ...data.education.flatMap((e) => [e.institution, e.title]),
    ...data.languages.flatMap((l) => [l.name, l.level]),
    // Las claves de puesto son un conjunto cerrado: un dato personal acá es una salida hostil, no un descarte
    ...data.suggested_roles,
    // `other_terms` no entra: cada término se revisa más abajo y se descarta solo (`term_sensitive`)
  ];
  if (texts.some(hasForbidden)) return err("sensitive_output");

  const dropped: Partial<Record<CvDropReason, number>> = {};
  const drop = (r: CvDropReason): void => {
    dropped[r] = (dropped[r] ?? 0) + 1;
  };

  // Skills: solo candidatas; repetidas → nivel más alto; verificada = aparece literal en el texto
  const candidateSlugs = new Set(ctx.candidates.map((c) => c.slug));
  const literal = new Set(
    extractSkillsFromText(
      ctx.text,
      compileTaxonomy(ctx.candidates.map((c) => ({ slug: c.slug, name: c.name, aliases: [] }))),
    ),
  );
  const bySlug = new Map<string, { level: number; years: number | null }>();
  for (const s of data.skills) {
    if (!candidateSlugs.has(s.slug)) {
      drop("skill_not_candidate");
      continue;
    }
    const prev = bySlug.get(s.slug);
    if (!prev || s.level > prev.level) bySlug.set(s.slug, { level: s.level, years: s.years });
  }
  const skills: CvProposal["skills"] = [...bySlug].map(([slug, v]) => {
    const verified = literal.has(slug);
    return {
      slug,
      level: verified ? (v.level as 1 | 2 | 3) : null,
      years: verified ? v.years : null,
      verified,
    };
  });

  const todayYear = Number.parseInt(ctx.today.slice(0, 4), 10);
  const maxYears = maxYearsFromText(ctx.text, todayYear);
  const yearsTotal =
    data.profile.years_total !== null && maxYears !== null && data.profile.years_total > maxYears
      ? null
      : data.profile.years_total;

  const englishCefr =
    data.profile.english_cefr !== null && cefrHasEvidence(data.profile.english_cefr, ctx.text)
      ? data.profile.english_cefr
      : null;

  let summary: string | null = null;
  let summaryInjection = false;
  if (data.profile.summary !== null) {
    if (detectCvInjection(data.profile.summary).hit) summaryInjection = true;
    else summary = cleanSummary(data.profile.summary);
  }

  // Todo texto libre del modelo pasa por el detector de inyección y sin URLs: es contenido derivado de un tercero
  const injected = (t: string): boolean => detectCvInjection(t).hit;
  const clean = (t: string): string =>
    stripCvUrls(t)
      .replace(/[^\S\n]+/g, " ")
      .trim();

  const targetTitle =
    data.profile.target_title === null || injected(data.profile.target_title)
      ? null
      : clean(data.profile.target_title) || null;
  const locationCity =
    data.profile.location_city === null || injected(data.profile.location_city)
      ? null
      : clean(data.profile.location_city) || null;

  const facts: CvProposal["facts"] = [];
  for (const f of data.facts) {
    if (injected(f.text)) {
      drop("injection");
      continue;
    }
    const kinds = findCvSensitive(f.text);
    if (kinds.includes("url") || kinds.includes("marital_status")) {
      drop("fact_sensitive");
      continue;
    }
    facts.push({ text: clean(f.text), kind: f.kind, source: "autodeclarado" });
  }

  /**
   * Viñetas originales (ADR-038 §7, D4): cada una tiene que ser substring normalizado del texto leído en
   * este mismo request; se devuelve el pedazo del CV, no la versión del modelo. Sin inyección, sin
   * marcadores de redacción, sin links ni datos sensibles, hasta 220 caracteres, sin repetir, hasta 6.
   */
  const verbatimBullets = (candidates: readonly string[]): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const b of candidates) {
      if (out.length >= CV_READ_MAX_BULLETS) break;
      if (b.trim() === "") continue;
      if (injected(b)) {
        drop("injection");
        continue;
      }
      if (REDACTION_MARKER_RE.test(b) || hasLinkOrEmail(b) || findCvSensitive(b).length > 0) {
        drop("bullet_sensitive");
        continue;
      }
      const original = cvVerbatim(ctx.text, b);
      if (original === null) {
        drop("bullet_not_in_cv");
        continue;
      }
      if (original.length > CV_BULLET_MAX_CHARS) {
        drop("bullet_too_long");
        continue;
      }
      const key = foldCvText(original).replace(/[\s.;,]+$/u, "");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(original);
    }
    return out;
  };

  const workHistory: CvProposal["workHistory"] = [];
  for (const w of data.work_history) {
    const invalid =
      (w.start !== null && w.end !== null && w.start > w.end) ||
      (w.start !== null && w.start > ctx.today) ||
      (w.end !== null && w.end > ctx.today);
    if (invalid) {
      drop("work_dates_invalid");
      continue;
    }
    if (injected(w.company) || injected(w.title)) {
      drop("injection");
      continue;
    }
    workHistory.push({
      company: clean(w.company),
      title: clean(w.title),
      start: w.start,
      end: w.end,
      bullets: verbatimBullets(w.bullets),
    });
  }

  const foldedText = foldCvText(ctx.text);
  const projects: CvProposal["projects"] = [];
  for (const p of data.projects) {
    const invalid =
      (p.start !== null && p.end !== null && p.start > p.end) ||
      (p.start !== null && p.start > ctx.today) ||
      (p.end !== null && p.end > ctx.today);
    if (invalid) {
      drop("project_dates_invalid");
      continue;
    }
    if (injected(p.name)) {
      drop("injection");
      continue;
    }
    const name = clean(p.name);
    if (name === "") continue;
    const role = p.role === null || injected(p.role) ? null : clean(p.role) || null;
    // El link: https válido (`cvProjectLink`) y literal en el texto leído. Hoy la redacción cambia los
    // links por «[link]» antes del modelo, así que en la práctica la persona lo completa en la tarjeta.
    const link =
      p.link !== null && cvProjectLink(p.link) === p.link.trim() && ctx.text.includes(p.link.trim())
        ? p.link.trim()
        : null;
    const stack: string[] = [];
    const seenStack = new Set<string>();
    for (const rawTerm of p.stack) {
      const term = rawTerm.trim();
      if (term === "") continue;
      if (!termInText(foldedText, term)) {
        drop("stack_not_in_cv");
        continue;
      }
      if (injected(term) || hasLinkOrEmail(term) || findCvSensitive(term).length > 0) {
        drop("term_sensitive");
        continue;
      }
      const key = foldCvText(term);
      if (seenStack.has(key) || stack.length >= CV_READ_MAX_STACK) continue;
      seenStack.add(key);
      stack.push(term);
    }
    projects.push({
      name,
      role,
      link,
      stack,
      start: p.start,
      end: p.end,
      bullets: verbatimBullets(p.bullets),
    });
  }

  const education: CvProposal["education"] = [];
  for (const e of data.education) {
    // Un estudio en curso puede tener un fin a futuro; un inicio a futuro o un fin anterior al inicio, no
    const invalid =
      (e.start !== null && e.end !== null && e.start > e.end) ||
      (e.start !== null && e.start > ctx.today);
    if (invalid) {
      drop("education_dates_invalid");
      continue;
    }
    if (injected(e.institution) || injected(e.title)) {
      drop("injection");
      continue;
    }
    const institution = clean(e.institution);
    const title = clean(e.title);
    if (institution === "" || title === "") continue;
    education.push({ institution, title, start: e.start, end: e.end });
  }

  const languages: CvProposal["languages"] = [];
  const seenLanguages = new Set<string>();
  for (const l of data.languages) {
    const name = clean(l.name);
    const level = l.level === null ? null : clean(l.level) || null;
    if (injected(l.name) || (l.level !== null && injected(l.level))) {
      drop("injection");
      continue;
    }
    const kinds = [...findCvSensitive(l.name), ...(level === null ? [] : findCvSensitive(level))];
    if (name === "" || kinds.includes("url")) {
      drop("language_invalid");
      continue;
    }
    const key = name.toLowerCase();
    if (seenLanguages.has(key)) continue;
    seenLanguages.add(key);
    languages.push({ name, level });
  }

  const roles: RoleKey[] = [];
  for (const r of data.suggested_roles) {
    if (!isRoleKey(r)) drop("role_unknown");
    else if (!roles.includes(r) && roles.length < SUGGESTED_ROLES_MAX) roles.push(r);
  }

  const candidateTaxonomy = compileTaxonomy(
    ctx.candidates.map((c) => ({ slug: c.slug, name: c.name, aliases: [] })),
  );
  const otherTerms: string[] = [];
  const seenTerms = new Set<string>();
  for (const raw of data.other_terms) {
    const term = raw.trim();
    if (term === "") continue;
    if (injected(term)) {
      drop("injection");
      continue;
    }
    if (hasForbidden(term)) {
      drop("term_sensitive");
      continue;
    }
    if (findCvSensitive(term).includes("url")) {
      drop("term_url");
      continue;
    }
    const key = term.toLowerCase();
    if (seenTerms.has(key) || extractSkillsFromText(term, candidateTaxonomy).length > 0) continue;
    seenTerms.add(key);
    otherTerms.push(term);
  }

  return ok({
    profile: {
      ...data.profile,
      target_title: targetTitle,
      location_city: locationCity,
      years_total: yearsTotal,
      english_cefr: englishCefr,
      summary,
    },
    skills,
    facts,
    workHistory,
    projects,
    education,
    languages,
    suggestedRoles: roles,
    otherTerms,
    flags: { summaryInjection, dropped },
  });
}
