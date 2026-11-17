import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CV_ISSUE_TYPES,
  type CvCoachItem,
  type CvReviewContext,
  type CvIssueType,
  type CvReviewItemKind,
  type SkillDemand,
  type SkillTaxonomyEntry,
} from "@job-search-os/pipeline";
import skillsSeed from "../../../packages/db/seeds/skills.json";

/**
 * Golden del coach de CV (R12-13, plan §5.1). Cada fixture trae el texto del CV, el puesto objetivo, la
 * **lectura ya normalizada** (lo que la persona confirmó en las tarjetas: es el caché de la lectura, así la
 * corrida arranca del diagnóstico y no gasta en `extract_cv_profile`), la demanda del pool de su carrera,
 * los `hechos` atómicos, los `problemas_esperados` y las `respuestas` guionadas de la persona.
 *
 * - Públicas: `evals/fixtures/cv-coach/*.json`, inventadas (11: los 3 de #514 y una por carrera de la beta).
 * - Privada: `fixtures-private/cv-coach/*.json` (el CV de Mauro), fuera del repo. El formato es el mismo; hay
 *   un ejemplo inventado en `fixtures-private.example/cv-coach/`. De una privada, los reportes guardan solo
 *   métricas (ni textos, ni preguntas, ni respuestas).
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const PUBLIC_DIR = join(ROOT, "evals/fixtures/cv-coach");
export const PRIVATE_DIR = join(ROOT, "fixtures-private/cv-coach");
export const PRIVATE_EXAMPLE_DIR = join(ROOT, "fixtures-private.example/cv-coach");

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY_RE = /^[a-z0-9-]{1,40}$/;

export type CvCoachFixtureItem = {
  /** Clave legible: la usan `problemas_esperados` y `respuestas`. */
  clave: string;
  id: string;
  kind: "trabajo" | "educacion" | "certificacion" | "proyecto";
  organization: string;
  title: string;
  startMonth: string | null;
  endMonth: string | null;
  isCurrent: boolean;
  bullets: string[];
  link: string | null;
};

export type Hecho = {
  /** Qué es: empresa, cargo, fecha, proyecto, número de un logro, link… */
  clave: string;
  valor: string;
  /** `cv`: está en la lectura. `respuesta`: solo cuenta si la persona llegó a decirlo en la charla. */
  fuente: "cv" | "respuesta";
};

export type ExpectedIssue =
  { tipo: CvIssueType; item: string | null } | { tipo: CvIssueType; skill: string };

/** Respuesta guionada: un texto, o varios (el primero a la pregunta, los siguientes a las repreguntas). */
export type ScriptedAnswer = string | string[];

export type CvCoachFixture = {
  id: string;
  carrera: string;
  puesto_objetivo: string;
  nota: string;
  cv_texto: string;
  lectura: { items: CvCoachFixtureItem[]; skills: string[]; resumen: string | null };
  /** Demanda del pool de la carrera (inventada para las públicas): slug y menciones. */
  demanda: { slug: string; mentions: number }[];
  hechos: Hecho[];
  problemas_esperados: ExpectedIssue[];
  /** Por tipo de problema: clave del ítem (o slug de la skill) → respuesta; `*` vale para el resto. */
  respuestas: Partial<Record<CvIssueType, Record<string, ScriptedAnswer>>>;
};

// ---------------------------------------------------------------------------
// Validación (sin zod: el paquete de evals no lo tiene como dependencia). Falla cerrado y nunca cita el
// contenido: una fixture privada trae datos reales.
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 10_000): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const isStrOrNull = (v: unknown, max = 10_000) => v === null || isStr(v, max);
const ISSUE_TYPES: readonly string[] = CV_ISSUE_TYPES;
const ITEM_KINDS = ["trabajo", "educacion", "certificacion", "proyecto"];

function onlyKeys(o: Obj, keys: readonly string[], where: string, out: string[]): void {
  for (const k of Object.keys(o)) if (!keys.includes(k)) out.push(`${where}: clave de más «${k}»`);
}

/** Problemas de formato de una fixture (vacío si está bien). Estricto: una clave de más es un error. */
export function fixtureShapeProblems(raw: unknown): string[] {
  const out: string[] = [];
  if (!isObj(raw)) return ["no es un objeto"];
  onlyKeys(
    raw,
    [
      "id",
      "carrera",
      "puesto_objetivo",
      "nota",
      "cv_texto",
      "lectura",
      "demanda",
      "hechos",
      "problemas_esperados",
      "respuestas",
    ],
    "fixture",
    out,
  );
  if (!(typeof raw.id === "string" && KEY_RE.test(raw.id))) out.push("id");
  if (!isStr(raw.carrera, 60)) out.push("carrera");
  if (!isStr(raw.puesto_objetivo, 120)) out.push("puesto_objetivo");
  if (typeof raw.nota !== "string") out.push("nota");
  if (!(typeof raw.cv_texto === "string" && raw.cv_texto.length >= 300))
    out.push("cv_texto (mínimo 300)");
  const l = raw.lectura;
  if (!isObj(l)) out.push("lectura");
  else {
    onlyKeys(l, ["items", "skills", "resumen"], "lectura", out);
    if (!Array.isArray(l.items) || l.items.length === 0 || l.items.length > 20)
      out.push("lectura.items");
    else
      l.items.forEach((it, n) => {
        const w = `lectura.items[${n}]`;
        if (!isObj(it)) return out.push(w);
        onlyKeys(
          it,
          [
            "clave",
            "id",
            "kind",
            "organization",
            "title",
            "startMonth",
            "endMonth",
            "isCurrent",
            "bullets",
            "link",
          ],
          w,
          out,
        );
        if (!(typeof it.clave === "string" && /^[a-z0-9-]{1,30}$/.test(it.clave)))
          out.push(`${w}.clave`);
        if (!(typeof it.id === "string" && UUID_RE.test(it.id))) out.push(`${w}.id`);
        if (!ITEM_KINDS.includes(it.kind as string)) out.push(`${w}.kind`);
        if (!isStr(it.organization, 120)) out.push(`${w}.organization`);
        if (!isStr(it.title, 120)) out.push(`${w}.title`);
        for (const m of ["startMonth", "endMonth"] as const) {
          if (!(it[m] === null || (typeof it[m] === "string" && MONTH_RE.test(it[m]))))
            out.push(`${w}.${m}`);
        }
        if (typeof it.isCurrent !== "boolean") out.push(`${w}.isCurrent`);
        if (!(
          Array.isArray(it.bullets) &&
          it.bullets.length <= 6 &&
          it.bullets.every((b) => isStr(b, 220))
        ))
          out.push(`${w}.bullets`);
        if (!(it.link === null || (typeof it.link === "string" && /^https:\/\/\S+$/.test(it.link))))
          out.push(`${w}.link`);
      });
    if (!(Array.isArray(l.skills) && l.skills.every((s) => isStr(s, 60))))
      out.push("lectura.skills");
    if (!isStrOrNull(l.resumen, 600)) out.push("lectura.resumen");
  }
  if (!Array.isArray(raw.demanda)) out.push("demanda");
  else
    raw.demanda.forEach((d, n) => {
      if (
        !isObj(d) ||
        !isStr(d.slug, 60) ||
        !Number.isInteger(d.mentions) ||
        (d.mentions as number) < 0
      )
        out.push(`demanda[${n}]`);
      else onlyKeys(d, ["slug", "mentions"], `demanda[${n}]`, out);
    });
  if (!Array.isArray(raw.hechos) || raw.hechos.length === 0) out.push("hechos");
  else
    raw.hechos.forEach((h, n) => {
      if (
        !isObj(h) ||
        !isStr(h.clave, 30) ||
        !isStr(h.valor, 120) ||
        !["cv", "respuesta"].includes(h.fuente as string)
      )
        out.push(`hechos[${n}]`);
      else onlyKeys(h, ["clave", "valor", "fuente"], `hechos[${n}]`, out);
    });
  if (!Array.isArray(raw.problemas_esperados)) out.push("problemas_esperados");
  else
    raw.problemas_esperados.forEach((e, n) => {
      const w = `problemas_esperados[${n}]`;
      if (!isObj(e) || !ISSUE_TYPES.includes(e.tipo as string)) return out.push(w);
      if ("skill" in e) {
        onlyKeys(e, ["tipo", "skill"], w, out);
        if (!isStr(e.skill, 60)) out.push(`${w}.skill`);
      } else {
        onlyKeys(e, ["tipo", "item"], w, out);
        if (!isStrOrNull(e.item, 30)) out.push(`${w}.item`);
      }
    });
  if (!isObj(raw.respuestas)) out.push("respuestas");
  else
    for (const [tipo, byKey] of Object.entries(raw.respuestas)) {
      if (!ISSUE_TYPES.includes(tipo) || !isObj(byKey)) {
        out.push(`respuestas.${tipo}`);
        continue;
      }
      for (const [k, v] of Object.entries(byKey)) {
        const ok =
          isStr(v, 2000) || (Array.isArray(v) && v.length > 0 && v.every((x) => isStr(x, 2000)));
        if (!ok) out.push(`respuestas.${tipo}.${k}`);
      }
    }
  return out;
}

export type LoadedCvCoachFixture = {
  fixture: CvCoachFixture;
  /** `private`: sus textos no van a ningún reporte. */
  source: "public" | "private";
  path: string;
};

/** Taxonomía de skills: la misma del seed. */
export const TAXONOMY: readonly SkillTaxonomyEntry[] = (
  skillsSeed as { slug: string; name: string; aliases: string[] }[]
).map((s) => ({ slug: s.slug, name: s.name, aliases: s.aliases }));

/** Problemas de coherencia interna de una fixture (claves, slugs, tipos). Vacío si está bien. */
export function fixtureProblems(f: CvCoachFixture): string[] {
  const out: string[] = [];
  const claves = new Set(f.lectura.items.map((i) => i.clave));
  const ids = new Set(f.lectura.items.map((i) => i.id));
  if (claves.size !== f.lectura.items.length) out.push("claves de ítem repetidas");
  if (ids.size !== f.lectura.items.length) out.push("ids de ítem repetidos");
  const slugs = new Set(TAXONOMY.map((t) => t.slug));
  for (const s of f.lectura.skills)
    if (!slugs.has(s)) out.push(`skill fuera de la taxonomía: ${s}`);
  for (const d of f.demanda)
    if (!slugs.has(d.slug)) out.push(`demanda fuera de la taxonomía: ${d.slug}`);
  for (const e of f.problemas_esperados) {
    if ("item" in e && e.item !== null && !claves.has(e.item))
      out.push(`esperado sin ítem: ${e.item}`);
    if ("skill" in e && !slugs.has(e.skill)) out.push(`esperado con skill desconocida: ${e.skill}`);
  }
  for (const [tipo, byKey] of Object.entries(f.respuestas)) {
    for (const k of Object.keys(byKey)) {
      if (k !== "*" && !claves.has(k) && !slugs.has(k))
        out.push(`respuesta ${tipo} sin destino: ${k}`);
    }
  }
  return out;
}

function parseFile(path: string): CvCoachFixture {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  // Los problemas nombran campos, nunca el contenido: una privada puede traer datos reales
  const shape = fixtureShapeProblems(raw);
  if (shape.length > 0) throw new Error(`fixture inválida (${path}): ${shape.join("; ")}`);
  const fixture = raw as CvCoachFixture;
  const problems = fixtureProblems(fixture);
  if (problems.length > 0) throw new Error(`fixture incoherente (${path}): ${problems.join("; ")}`);
  return fixture;
}

function jsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => join(dir, f));
}

/**
 * Carga el golden: las públicas siempre; las privadas solo con `privadas: true` y si la carpeta existe (en el
 * CI y en un clon del repo no existe y no pasa nada). `ids` filtra.
 */
export function loadCvCoachGolden(
  opts: {
    privadas?: boolean;
    ids?: readonly string[];
    publicDir?: string;
    privateDir?: string;
  } = {},
): LoadedCvCoachFixture[] {
  const pub = jsonFiles(opts.publicDir ?? PUBLIC_DIR).map((path) => ({
    fixture: parseFile(path),
    source: "public" as const,
    path,
  }));
  const priv = opts.privadas
    ? jsonFiles(opts.privateDir ?? PRIVATE_DIR).map((path) => ({
        fixture: parseFile(path),
        source: "private" as const,
        path,
      }))
    : [];
  const all = [...pub, ...priv];
  const seen = new Set<string>();
  for (const f of all) {
    if (seen.has(f.fixture.id)) throw new Error(`id de fixture repetido: ${f.fixture.id}`);
    seen.add(f.fixture.id);
  }
  return opts.ids ? all.filter((f) => opts.ids!.includes(f.fixture.id)) : all;
}

/** Demanda con la forma de `computeDemand` (las menciones son todas «must» y pesan 1). */
export function fixtureDemand(f: CvCoachFixture): SkillDemand[] {
  return [...f.demanda]
    .sort((a, b) => b.mentions - a.mentions)
    .map((d) => ({
      slug: d.slug,
      mentions: d.mentions,
      mustMentions: d.mentions,
      weightedDemand: d.mentions,
    }));
}

/** Contexto del diagnóstico: lo mismo que arma la ruta con lo confirmado. */
export function reviewContext(
  f: CvCoachFixture,
  items: readonly CvCoachFixtureItem[] = f.lectura.items,
): CvReviewContext {
  return {
    target: f.puesto_objetivo,
    items: items.map((i) => ({
      id: i.id,
      kind: i.kind as CvReviewItemKind,
      organization: i.organization,
      title: i.title,
      startMonth: i.startMonth,
      endMonth: i.endMonth,
      bullets: i.bullets,
      link: i.link,
    })),
    personSkills: f.lectura.skills,
    taxonomy: TAXONOMY,
    demand: fixtureDemand(f),
    summary: f.lectura.resumen,
  };
}

const SECTION_OF: Record<CvCoachFixtureItem["kind"], CvCoachItem["section"]> = {
  trabajo: "experience",
  proyecto: "projects",
  educacion: "education",
  certificacion: "education",
};

export function coachItems(items: readonly CvCoachFixtureItem[]): CvCoachItem[] {
  return items.map((i) => ({
    id: i.id,
    section: SECTION_OF[i.kind],
    organization: i.organization,
    title: i.title,
    startMonth: i.startMonth,
    endMonth: i.endMonth,
    isCurrent: i.isCurrent,
    bullets: i.bullets,
    link: i.link,
  }));
}

/** `slug` → nombre de la skill, para las que nombra el diagnóstico. */
export function skillNames(): Record<string, string> {
  return Object.fromEntries(TAXONOMY.map((t) => [t.slug, t.name]));
}
