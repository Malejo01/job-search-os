import type { CriteriaRules } from "../criteria";
import { englishRankFromCefr, type Decision } from "../decide";
import type { Evaluation } from "../evaluation";
import { foldText } from "../normalize/text";
import { MAX_JD_CHARS } from "../pool/career/english";
import { englishIsNotAGap } from "../skills/english-gap";
import { extractSkillsFromText, type Term } from "../skills/match";
import {
  monthlySalaryUsd,
  SALARY_FROM_TEXT_NOTE,
  salaryIsFromApi,
  type JobFacts,
} from "./job-facts";

/**
 * Checklist de requisitos del aviso (ronda 98, §2.1; fase A de la 104). Puro: el worker carga los
 * datos y esto arma la vista. NO toca el score ni la acción: es lo que se muestra para explicar la
 * decisión. El modelo nunca dice "cumple": el estado sale del perfil y de los campos tipados.
 */
export type ChecklistStatus = "cumple" | "no_cumple" | "no_se_sabe";

export type ChecklistItem = {
  /** "anos" | "ingles" | "modalidad" | "pais" | "residencia" | "autorizacion" | "salario" | "jornada" | "disciplina" | "skill:<slug>" | "req:<n>" */
  id: string;
  kind: "estructurado" | "skill" | "texto";
  nivel: "must" | "deseable";
  /** Qué exige el aviso, corto, en español. */
  pide: string;
  /** Cita literal del aviso (solo ítems que vienen del modelo, fase B). */
  evidencia: string | null;
  /** Qué tiene la persona, del perfil; null = no se sabe. */
  tenes: string | null;
  status: ChecklistStatus;
  fuente: { pide: "fuente" | "modelo"; tenes: "perfil" | "skills" | null };
  /** true si el ítem está detrás de un bloqueador de `decision`. */
  bloquea: boolean;
  /** Aclaración sobre la confiabilidad del dato (p. ej. salario leído del texto). Ausente = ninguna. */
  nota?: string;
};

export type ChecklistCounts = { cumple: number; no_cumple: number; no_se_sabe: number };

export type Checklist = {
  items: ChecklistItem[];
  must: ChecklistCounts;
  deseable: ChecklistCounts;
  /** had_full_jd=false: checklist sobre el resumen, no sobre la JD. */
  parcial: boolean;
  /** El primer ítem `no_cumple` en el orden en que mira un reclutador (§4). */
  descarte_rapido: ChecklistItem | null;
};

export type ChecklistContext = {
  profile: {
    yearsTotal?: number | null;
    englishCefr?: string | null;
    locationCountry: string;
    workAuth: { us: boolean; eu: boolean; other?: string[] };
    acceptedModalities: readonly string[];
    // Piso salarial y jornada máxima NO van acá: salen de `rules`, igual que en decide()
  };
  /** Hechos del aviso (`jobs.*`). */
  job: JobFacts & { countriesAllowed?: readonly string[] | null; hadFullJd: boolean };
  /** skill_levels de la persona por slug (0–3). */
  skillLevels: ReadonlyMap<string, number>;
  /** user_skills (ronda 78): se usan solo como respaldo por nombre cuando no hay fila en skill_levels. */
  userSkills: readonly { name: string; level: number }[];
  /** Taxonomía compilada (`compileTaxonomy`). */
  terms: readonly Term[];
  /** Nombre legible por slug; sin él se usa el slug. */
  skillNames?: ReadonlyMap<string, string>;
};

const NO_ENGLISH_ASK = new Set(["no_menciona", "no"]);
const ENGLISH_LABEL: Record<string, string> = {
  basico: "básico",
  intermedio: "intermedio",
  avanzado: "avanzado",
  nativo: "nativo",
};

/** Orden de la lente del reclutador (§4): ¿puede trabajar acá?, ¿mismo oficio?, ¿nivel?, idioma, número. */
const DESCARTE_ORDER = [
  "residencia", // la residencia exigida también pone «país» en no_cumple: se muestra la más específica
  "pais",
  "autorizacion",
  "modalidad",
  "disciplina",
  "anos",
  "ingles",
  "salario",
  "jornada",
];

const IS_AUTH_BLOCKER = /visa|autoriz|work auth|sponsor/i;
const IS_MODALITY_BLOCKER = /presencial|h[ií]brid|oficina|on-?site/i;
const IS_HOURS_BLOCKER = /jornada|horas/i;
const IS_YEARS_BLOCKER = /a[ñn]os|years/i;
const IS_SALARY_BLOCKER = /salari|sueldo|remuneraci|piso/i;

const label = (s: string) => s.replace(/_/g, " ");
const usd = (n: number) => `USD ${n}`;

/**
 * Topes para que un aviso largo no haga fallar la validación al leer. Del otro lado, el zod de
 * `apps/web/lib/job-detail.ts` (`checklistItemSchema` / `checklistSchema`) acepta `pide`/`tenes`
 * hasta 200 caracteres y hasta 40 ítems: si cambiás estos números, cambiá esos.
 */
export const CHECKLIST_TEXT_MAX = 160;
export const CHECKLIST_MAX_ITEMS = 40;
const MAX_COUNTRIES = 5;
const MAX_NAMED_SKILLS = 20;

const clip = (s: string): string =>
  s.length > CHECKLIST_TEXT_MAX ? `${s.slice(0, CHECKLIST_TEXT_MAX - 1)}…` : s;

const item = (
  p: Pick<ChecklistItem, "id" | "pide" | "tenes" | "status"> &
    Partial<Pick<ChecklistItem, "kind" | "nivel" | "bloquea" | "fuente" | "nota">>,
): ChecklistItem => ({
  kind: "estructurado",
  nivel: "must",
  evidencia: null,
  bloquea: false,
  fuente: { pide: "fuente", tenes: "perfil" },
  ...p,
  pide: clip(p.pide),
  tenes: p.tenes === null ? null : clip(p.tenes),
});

const emptyCounts = (): ChecklistCounts => ({ cumple: 0, no_cumple: 0, no_se_sabe: 0 });

export function buildChecklist(
  ev: Evaluation,
  d: Decision,
  rules: CriteriaRules,
  ctx: ChecklistContext,
): Checklist {
  const items: ChecklistItem[] = [];
  const { profile, job } = ctx;
  const blockers = d.bloqueadores;
  const blockerWith = (re: RegExp) => blockers.find((b) => re.test(b));

  // ── Residencia / país / autorización: ¿puede trabajar acá? ───────────────────────────────────
  const residency = blockerWith(/residencia exigida/i);
  const countries = ev.paises_permitidos?.length
    ? ev.paises_permitidos
    : (job.countriesAllowed ?? []);
  // El estado sale de la decisión (d.locationOk), que ya incorpora la residencia exigida
  if (d.locationOk !== "ok" || countries.length > 0) {
    const status: ChecklistStatus =
      d.locationOk === "ok" ? "cumple" : d.locationOk === "no" ? "no_cumple" : "no_se_sabe";
    const shown = countries.slice(0, MAX_COUNTRIES).join(", ");
    const more =
      countries.length > MAX_COUNTRIES ? ` y ${countries.length - MAX_COUNTRIES} más` : "";
    items.push(
      item({
        id: "pais",
        pide: countries.length ? `Disponible en ${shown}${more}` : "Ubicación permitida",
        tenes: profile.locationCountry || null,
        status,
      }),
    );
  }
  if (residency) {
    const places = residency.replace(/^residencia exigida en\s*/i, "").trim();
    items.push(
      item({
        id: "residencia",
        pide: places ? `Residir en ${places}` : "Residencia en el país del aviso",
        tenes: profile.locationCountry || null,
        status: "no_cumple",
        bloquea: true,
      }),
    );
  }
  const auth = blockerWith(IS_AUTH_BLOCKER);
  if (auth) {
    const wantsUs = /\bus\b|eeuu|estados unidos|united states|\busa\b/i.test(auth);
    const wantsEu = /\beu\b|europ|schengen/i.test(auth);
    const has = (wantsUs && profile.workAuth.us) || (wantsEu && profile.workAuth.eu);
    const held = [profile.workAuth.us ? "US" : null, profile.workAuth.eu ? "UE" : null]
      .concat(profile.workAuth.other ?? [])
      .filter(Boolean);
    items.push(
      item({
        id: "autorizacion",
        pide: auth,
        tenes: held.length
          ? `Autorización: ${held.join(", ")}`
          : "Sin autorización fuera de tu país",
        status: has ? "cumple" : "no_cumple",
        bloquea: !has,
        fuente: { pide: "modelo", tenes: "perfil" },
      }),
    );
  }

  // ── Modalidad ────────────────────────────────────────────────────────────────────────────────
  if (ev.modalidad !== "desconocida") {
    const ok = profile.acceptedModalities.includes(ev.modalidad);
    items.push(
      item({
        id: "modalidad",
        pide: `Modalidad ${ev.modalidad}`,
        tenes: `Aceptás: ${profile.acceptedModalities.join(", ") || "ninguna"}`,
        status: ok ? "cumple" : "no_cumple",
        bloquea: !ok && blockers.some((b) => IS_MODALITY_BLOCKER.test(b)),
        fuente: { pide: "modelo", tenes: "perfil" },
      }),
    );
  }

  // ── Disciplina ───────────────────────────────────────────────────────────────────────────────
  const allowed =
    Array.isArray(rules.allowed_disciplines) && rules.allowed_disciplines.length > 0
      ? rules.allowed_disciplines
      : null;
  items.push(
    item({
      id: "disciplina",
      pide: `Puesto de ${label(ev.disciplina)}`,
      tenes: allowed ? allowed.map(label).join(", ") : null,
      status:
        allowed === null ? "no_se_sabe" : allowed.includes(ev.disciplina) ? "cumple" : "no_cumple",
      bloquea: blockers.some((b) => /disciplina distinta/i.test(b)),
      fuente: { pide: "modelo", tenes: allowed ? "perfil" : null },
    }),
  );

  // ── Años ─────────────────────────────────────────────────────────────────────────────────────
  if (ev.years_required !== null) {
    const tiene = profile.yearsTotal ?? null;
    const otroOficio =
      allowed !== null && ev.years_discipline !== null && !allowed.includes(ev.years_discipline);
    const status: ChecklistStatus = otroOficio
      ? "no_cumple"
      : tiene === null
        ? "no_se_sabe"
        : ev.years_required > tiene
          ? "no_cumple"
          : "cumple";
    const dominio = ev.years_domain ? ` de ${ev.years_domain}` : "";
    items.push(
      item({
        id: "anos",
        pide: `${ev.years_required} años${dominio}`,
        tenes: tiene === null ? null : `${tiene} años`,
        status,
        bloquea: blockers.some((b) => IS_YEARS_BLOCKER.test(b) || /otro dominio/i.test(b)),
        fuente: { pide: "modelo", tenes: tiene === null ? null : "perfil" },
      }),
    );
  }

  // ── Inglés: en un aviso en español que no lo pide no hay ítem ────────────────────────────────
  if (!NO_ENGLISH_ASK.has(ev.ingles_requerido) && !englishIsNotAGap(job.jdText ?? null, null)) {
    const pedido = ENGLISH_RANK[ev.ingles_requerido];
    const mio = englishRankFromCefr(profile.englishCefr);
    items.push(
      item({
        id: "ingles",
        pide: `Inglés ${ENGLISH_LABEL[ev.ingles_requerido] ?? ev.ingles_requerido}`,
        tenes: mio === null ? null : (profile.englishCefr ?? null),
        status:
          mio === null || pedido === undefined
            ? "no_se_sabe"
            : pedido <= mio
              ? "cumple"
              : "no_cumple",
        fuente: { pide: "modelo", tenes: mio === null ? null : "perfil" },
      }),
    );
  }

  // ── Salario: solo si el aviso trae cifras ────────────────────────────────────────────────────
  const hasSalary = Boolean(job.salaryMinUsd || job.salaryMaxUsd);
  if (hasSalary) {
    const monthly = monthlySalaryUsd(job);
    const floor = rules.salary_floor_usd_monthly ?? null; // la misma fuente que decide()
    const fromApi = salaryIsFromApi(job);
    const comparable = fromApi && monthly?.max != null && typeof floor === "number" && floor > 0;
    const rango = [job.salaryMinUsd, job.salaryMaxUsd].filter(Boolean).join("–");
    const periodo = job.salaryPeriod ? `/${job.salaryPeriod}` : "";
    items.push(
      item({
        id: "salario",
        pide: `Salario USD ${rango}${periodo}`,
        tenes: typeof floor === "number" && floor > 0 ? `Piso ${usd(floor)}/mes` : null,
        status: !comparable ? "no_se_sabe" : monthly!.max! >= floor! ? "cumple" : "no_cumple",
        bloquea: blockers.some((b) => IS_SALARY_BLOCKER.test(b)),
        fuente: { pide: "fuente", tenes: typeof floor === "number" && floor > 0 ? "perfil" : null },
        ...(fromApi ? {} : { nota: SALARY_FROM_TEXT_NOTE }),
      }),
    );
  }

  // ── Jornada: horas de la fuente o bloqueador del modelo ──────────────────────────────────────
  const maxHours = rules.max_weekly_hours;
  const hoursBlocker = blockerWith(IS_HOURS_BLOCKER);
  if (typeof job.weeklyHours === "number") {
    const known = typeof maxHours === "number" && maxHours > 0;
    items.push(
      item({
        id: "jornada",
        pide: `${job.weeklyHours} h semanales`,
        tenes: known ? `Máximo ${maxHours} h` : null,
        status: !known ? "no_se_sabe" : job.weeklyHours <= maxHours! ? "cumple" : "no_cumple",
        bloquea: Boolean(hoursBlocker),
        fuente: { pide: "fuente", tenes: known ? "perfil" : null },
      }),
    );
  } else if (hoursBlocker) {
    items.push(
      item({
        id: "jornada",
        pide: hoursBlocker,
        tenes: typeof maxHours === "number" ? `Máximo ${maxHours} h` : null,
        status: "no_cumple",
        bloquea: true,
        fuente: { pide: "modelo", tenes: typeof maxHours === "number" ? "perfil" : null },
      }),
    );
  }

  // ── Skills que nombra el aviso (fase A): job_skills × skill_levels. No entran al "X de Y" ────
  const userByName = new Map(ctx.userSkills.map((u) => [foldText(u.name).trim(), u.level]));
  // Tope de largo: el aviso es texto de terceros; nada de lo que sigue mira más de MAX_JD_CHARS
  const jdText = (job.jdText ?? "").slice(0, MAX_JD_CHARS);
  // En el orden en que el aviso las nombra
  const jdFolded = foldText(jdText);
  const firstAt = (slug: string) =>
    Math.min(
      ...ctx.terms
        .filter((t) => t.slug === slug)
        .map((t) => t.re.exec(jdFolded)?.index ?? Number.MAX_SAFE_INTEGER),
    );
  const slugs = jdText
    ? extractSkillsFromText(jdText, ctx.terms)
        .filter((s) => !s.startsWith("english_"))
        .sort((a, b) => firstAt(a) - firstAt(b))
        .slice(0, MAX_NAMED_SKILLS)
    : [];
  for (const slug of slugs) {
    const name = ctx.skillNames?.get(slug) ?? label(slug);
    const level = ctx.skillLevels.get(slug) ?? userByName.get(foldText(name).trim()) ?? null;
    items.push(
      item({
        id: `skill:${slug}`,
        kind: "skill",
        nivel: "deseable",
        pide: `Menciona ${name}`,
        tenes: level === null ? null : `Nivel ${level} de 3`,
        status: level === null ? "no_se_sabe" : level >= 2 ? "cumple" : "no_cumple",
        fuente: { pide: "fuente", tenes: level === null ? null : "skills" },
      }),
    );
  }

  const must = emptyCounts();
  const deseable = emptyCounts();
  for (const it of items) {
    if (it.kind === "skill") continue; // fase A: las skills nombradas no entran al titular
    (it.nivel === "must" ? must : deseable)[it.status]++;
  }
  const descarte_rapido =
    DESCARTE_ORDER.flatMap((id) =>
      items.filter((i) => i.id === id && i.status === "no_cumple"),
    )[0] ?? null;

  return { items, must, deseable, parcial: !job.hadFullJd, descarte_rapido };
}

const ENGLISH_RANK: Record<string, number> = { basico: 1, intermedio: 2, avanzado: 3, nativo: 4 };
