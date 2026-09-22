import { and, eq, inArray, sql as rawSql } from "drizzle-orm";
import {
  compileTaxonomy,
  matchStack,
  normalizeCompany,
  normalizeTitle,
} from "@job-search-os/pipeline";
import * as s from "../schema";
import routingSeed from "../seeds/model_routing.json";
import { hashPassword } from "./password";
import skillsSeed from "../seeds/skills.json";
import learningResourcesSeed from "../seeds/learning_resources.json";
import { createDb, type Db } from "./client";
import { loadFixture } from "./fixtures";
import { confirmRemoteTarget } from "./confirm-remote";
import { describeDatabaseUrl, loadLocalEnv, requireDatabaseUrl } from "./env";

/**
 * Seeds: catálogo (skills, model_routing), usuario de Mauro (perfil, criterios v1,
 * talent_platforms) y el golden set como jobs + evaluations(model='human') + applications.
 * Idempotente: catálogo y perfil hacen upsert; los jobs del golden se identifican por
 * job_sources(source_name='golden', external_id=<id>) y no se duplican.
 * Uso: pnpm db:seed. Env opcional: SEED_USER_ID (uuid del auth user), INGEST_DOMAIN.
 */

/**
 * Datos del usuario: privados (fixtures-private/) si existen, de ejemplo si no. Ver fixtures.ts.
 */
type ProfileSeed = {
  profile: {
    display_name: string;
    headline: string;
    location_country: string;
    location_city: string;
    remote_only: boolean;
    work_auth: { us: boolean; eu: boolean; other?: string[] };
    years_total: number;
    years_enterprise: number;
    english_cefr: string;
    salary_floor_usd: number;
    max_weekly_hours: number;
    timezone: string;
    profile_summary: string;
  };
  talent_platforms: { name: string; url: string; status: string; notes?: string }[];
};
type SkillLevelsSeed = { levels: { slug: string; level: number; confidence: number }[] };
type GoldenFile = { meta: { version: string }; jobs: unknown[] };
const goldenFx = loadFixture<GoldenFile>("golden");
const profileFx = loadFixture<ProfileSeed>("profile");
const criteriaFx = loadFixture<s.CriteriaRules>("criteria");
const skillLevelsFx = loadFixture<SkillLevelsSeed>("skill_levels");
const golden = goldenFx.data;
const profileSeed = profileFx.data;
const criteriaSeed = criteriaFx.data;
const skillLevelsSeed = skillLevelsFx.data;
console.log(
  `datos del usuario: ${profileFx.source === "private" ? "fixtures-private/ (reales)" : "seeds de EJEMPLO"} · golden: ${goldenFx.source} (${goldenFx.path})`,
);

/** UUID fijo del usuario hasta que exista el auth user real (JS-014/JS-019). */
export const DEFAULT_SEED_USER_ID = "a0000000-0000-4000-8000-000000000001";

type GoldenJob = {
  id: number;
  empresa: string;
  titulo: string;
  fuente: string;
  fecha: string;
  ubicacion: string | null;
  paises: string[] | null;
  modalidad: string;
  contrato: string | null;
  salario: { min: number; max: number; periodo: string; nota?: string } | null;
  anos: number | null;
  nivel: string | null;
  disciplina: string;
  ingles: string;
  tipo_empresa: string;
  stack: string[];
  match: string[];
  gaps: string[];
  bloqueadores: string[];
  senales: string[];
  candidatos: number | null;
  badges: string[];
  human_score: number | null;
  score_nota?: string;
  accion: string;
  estado: string;
  location_ok: string;
  duplicate_of?: number;
  notas?: string;
};

type JobStatus = (typeof s.jobStatus.enumValues)[number];
type SourceKind = (typeof s.sourceKind.enumValues)[number];
type Outcome = (typeof s.applicationOutcome.enumValues)[number];

/** Estado del golden (vocabulario de Mauro) → jobs.status (máquina de estados). */
const STATUS_BY_GOLDEN: Record<string, JobStatus> = {
  // Vocabulario del golden público (anonimizado)
  postulada: "aplicada",
  evaluada: "evaluada",
  cerrada: "cerrada",
  descartada_prefiltro: "descartada_prefiltro",
  // Vocabulario del golden privado (estados reales)
  descartada: "descartada",
  no_aplicada: "evaluada",
  aplicada: "aplicada",
  rechazo_automatico_ubicacion: "rechazo_automatico",
  no_aplicable: "descartada_prefiltro",
  cerrada_antes_de_aplicar: "cerrada",
  entrevista_pendiente: "entrevista",
  contacto_recruiter: "evaluada",
};

/** Resultado de la postulación, solo para estados donde hubo postulación real. */
const OUTCOME_BY_GOLDEN: Partial<Record<string, Outcome>> = {
  postulada: "sin_respuesta",
  aplicada: "sin_respuesta",
  rechazo_automatico_ubicacion: "rechazo_automatico_ubicacion",
  entrevista_pendiente: "entrevista",
};

function sourceKindOf(fuente: string): SourceKind {
  if (fuente === "getonboard") return "getonboard_api";
  if (fuente.startsWith("linkedin_alerta")) return "email_linkedin";
  if (fuente === "email_alerta_antigua") return "email_generic";
  if (fuente.startsWith("linkedin_")) return "manual";
  return "other";
}

function channelOf(fuente: string): string {
  if (fuente.startsWith("linkedin")) return "linkedin";
  if (fuente === "getonboard") return "getonboard";
  if (fuente === "indeed") return "indeed";
  if (fuente === "remote_rocketship") return "plataforma";
  return "sitio_empresa";
}

/** "3 de 4 aptitudes coinciden" → 0.75 */
function skillsMatchRatio(badges: string[]): number | null {
  for (const b of badges) {
    const m = /(\d+) de (\d+) aptitudes/.exec(b);
    if (m) return Number(m[1]) / Number(m[2]);
  }
  return null;
}

/** "indefinido 48 hs" → 48 */
function weeklyHoursOf(contrato: string | null): number | null {
  const m = contrato ? /(\d{2})\s*h/.exec(contrato) : null;
  return m ? Number(m[1]) : null;
}

const enumValue = <T extends readonly string[]>(values: T, v: string, fallback: T[number]) =>
  (values as readonly string[]).includes(v) ? (v as T[number]) : fallback;

async function seedCatalog(db: Db): Promise<void> {
  await db
    .insert(s.skills)
    .values(
      skillsSeed.map((k) => ({
        slug: k.slug,
        name: k.name,
        category: enumValue(s.skillCategory.enumValues, k.category, "otra"),
        aliases: k.aliases,
        closureHours: k.closure_hours,
        isGlobal: true,
      })),
    )
    .onConflictDoUpdate({
      target: s.skills.slug,
      set: {
        name: rawSql`excluded.name`,
        category: rawSql`excluded.category`,
        aliases: rawSql`excluded.aliases`,
        closureHours: rawSql`excluded.closure_hours`,
      },
    });

  // Catálogo de recursos de formación (JS-034): lo carga Mauro a mano en el seed; idempotente por url
  const skillBySlug = new Map(
    (await db.select({ id: s.skills.id, slug: s.skills.slug }).from(s.skills)).map((k) => [
      k.slug,
      k.id,
    ]),
  );
  for (const r of learningResourcesSeed.resources) {
    const skillId = skillBySlug.get(r.skill);
    if (!skillId) {
      console.warn(`learning_resources: skill desconocida ${r.skill} (${r.title})`);
      continue;
    }
    const row = {
      skillId,
      title: r.title,
      provider: r.provider,
      url: r.url,
      hours: r.hours,
      costUsd: r.cost_usd,
      targetLevel: r.target_level,
      proposedByLlm: false,
      approved: r.approved,
    };
    const [existing] = await db
      .select({ id: s.learningResources.id })
      .from(s.learningResources)
      .where(eq(s.learningResources.url, r.url))
      .limit(1);
    if (existing)
      await db.update(s.learningResources).set(row).where(eq(s.learningResources.id, existing.id));
    else await db.insert(s.learningResources).values(row);
  }

  await db
    .insert(s.modelRouting)
    .values(
      routingSeed.map((r) => ({
        task: r.task,
        provider: r.provider,
        model: r.model,
        fallbackModel: r.fallback_model,
        temperature: r.temperature,
        maxTokens: r.max_tokens,
        thinkingLevel: r.thinking_level,
        inputUsdPerMtok: r.input_usd_per_mtok,
        outputUsdPerMtok: r.output_usd_per_mtok,
        fallbackInputUsdPerMtok: r.fallback_input_usd_per_mtok,
        fallbackOutputUsdPerMtok: r.fallback_output_usd_per_mtok,
      })),
    )
    .onConflictDoUpdate({
      target: s.modelRouting.task,
      set: {
        provider: rawSql`excluded.provider`,
        model: rawSql`excluded.model`,
        fallbackModel: rawSql`excluded.fallback_model`,
        temperature: rawSql`excluded.temperature`,
        maxTokens: rawSql`excluded.max_tokens`,
        thinkingLevel: rawSql`excluded.thinking_level`,
        inputUsdPerMtok: rawSql`excluded.input_usd_per_mtok`,
        outputUsdPerMtok: rawSql`excluded.output_usd_per_mtok`,
        fallbackInputUsdPerMtok: rawSql`excluded.fallback_input_usd_per_mtok`,
        fallbackOutputUsdPerMtok: rawSql`excluded.fallback_output_usd_per_mtok`,
        updatedAt: new Date(),
      },
    });
}

async function seedUser(db: Db, userId: string): Promise<void> {
  const p = profileSeed.profile;
  const ingestDomain = process.env.INGEST_DOMAIN ?? "ingest.local";
  const profileRow = {
    displayName: p.display_name,
    headline: p.headline,
    locationCountry: p.location_country,
    locationCity: p.location_city,
    remoteOnly: p.remote_only,
    workAuth: p.work_auth,
    yearsTotal: p.years_total,
    yearsEnterprise: p.years_enterprise,
    englishCefr: p.english_cefr,
    salaryFloorUsd: p.salary_floor_usd,
    maxWeeklyHours: p.max_weekly_hours,
    timezone: p.timezone,
    profileSummary: p.profile_summary,
    updatedAt: new Date(),
  };
  // Usuario de Auth.js (ADR-010): mismo id que profiles.user_id; contraseña desde SEED_USER_PASSWORD
  const email = (process.env.SEED_USER_EMAIL ?? "mauro@job-search-os.local").trim().toLowerCase();
  const password = process.env.SEED_USER_PASSWORD;
  const passwordHash = password ? hashPassword(password) : null;
  await db
    .insert(s.users)
    .values({ id: userId, email, name: p.display_name, passwordHash })
    .onConflictDoUpdate({
      target: s.users.id,
      set: {
        email,
        name: p.display_name,
        ...(passwordHash ? { passwordHash } : {}),
        updatedAt: new Date(),
      },
    });
  if (!password) {
    console.warn(
      "SEED_USER_PASSWORD no definida: el usuario queda sin contraseña nueva (no puede entrar hasta cargarla)",
    );
  }
  await db
    .insert(s.profiles)
    .values({
      userId,
      inboundAddress: `u_${userId.slice(0, 8)}@${ingestDomain}`,
      ...profileRow,
    })
    // inbound_address también se actualiza: cambiar INGEST_DOMAIN y volver a sembrar alcanza (JS-020)
    .onConflictDoUpdate({
      target: s.profiles.userId,
      set: { ...profileRow, inboundAddress: `u_${userId.slice(0, 8)}@${ingestDomain}` },
    });

  const rules = criteriaSeed as s.CriteriaRules;
  await db
    .insert(s.evaluationCriteria)
    .values({ userId, version: 1, active: true, rules })
    .onConflictDoUpdate({
      target: [s.evaluationCriteria.userId, s.evaluationCriteria.version],
      set: { rules, active: true },
    });

  // Niveles de skills autodeclarados (adelanto de JS-031): provisorios hasta la entrevista dirigida
  const skillIds = await db.select({ id: s.skills.id, slug: s.skills.slug }).from(s.skills);
  const idBySlug = new Map(skillIds.map((k) => [k.slug, k.id]));
  for (const lv of skillLevelsSeed.levels) {
    const skillId = idBySlug.get(lv.slug);
    if (!skillId) {
      console.warn(`skill_levels: slug desconocido en la taxonomía: ${lv.slug}`);
      continue;
    }
    await db
      .insert(s.skillLevels)
      .values({
        userId,
        skillId,
        level: lv.level,
        confidence: lv.confidence,
        state: "sin_evidencia",
      })
      .onConflictDoUpdate({
        target: [s.skillLevels.userId, s.skillLevels.skillId],
        set: { level: lv.level, confidence: lv.confidence, updatedAt: new Date() },
      });
  }

  const existing = await db
    .select({ name: s.talentPlatforms.name })
    .from(s.talentPlatforms)
    .where(eq(s.talentPlatforms.userId, userId));
  const have = new Set(existing.map((e) => e.name));
  const missing = profileSeed.talent_platforms.filter((t) => !have.has(t.name));
  if (missing.length) {
    await db.insert(s.talentPlatforms).values(
      missing.map((t) => ({
        userId,
        name: t.name,
        url: t.url,
        status: t.status,
        notes: "notes" in t ? t.notes : null,
      })),
    );
  }
}

async function seedGolden(db: Db, userId: string): Promise<{ inserted: number; skipped: number }> {
  const jobs = (golden.jobs as GoldenJob[]).slice().sort((a, b) => a.id - b.id);

  // Empresas (catálogo global): insertar las que faltan y mapear por nombre normalizado
  const byNormalized = new Map<string, string>();
  for (const j of jobs) {
    const n = normalizeCompany(j.empresa);
    if (!byNormalized.has(n)) byNormalized.set(n, j.empresa);
  }
  await db
    .insert(s.companies)
    .values(
      [...byNormalized].map(([nameNormalized, displayName]) => ({
        nameNormalized,
        displayName: displayName
          .replace(/\s*\(.*$/, "")
          .replace(/.*→\s*/, "")
          .trim(),
      })),
    )
    .onConflictDoNothing({ target: s.companies.nameNormalized });
  const companyRows = await db
    .select({ id: s.companies.id, nameNormalized: s.companies.nameNormalized })
    .from(s.companies)
    .where(inArray(s.companies.nameNormalized, [...byNormalized.keys()]));
  const companyId = new Map(companyRows.map((c) => [c.nameNormalized, c.id]));

  // Jobs ya sembrados (idempotencia)
  const seeded = await db
    .select({ externalId: s.jobSources.externalId, jobId: s.jobSources.jobId })
    .from(s.jobSources)
    .innerJoin(s.jobs, eq(s.jobs.id, s.jobSources.jobId))
    .where(and(eq(s.jobSources.sourceName, "golden"), eq(s.jobs.userId, userId)));
  const jobIdByGolden = new Map<number, string>(seeded.map((r) => [Number(r.externalId), r.jobId]));

  let inserted = 0;
  for (const j of jobs) {
    if (jobIdByGolden.has(j.id)) continue;

    const flags: string[] = [];
    if (j.location_ok === "riesgo") flags.push("location_risk");
    if (j.duplicate_of) flags.push("volume_recruiting");
    if (j.estado === "contacto_recruiter") flags.push("contacto_recruiter");
    const postedAt = new Date(`${j.fecha}T12:00:00-03:00`);

    const [job] = await db
      .insert(s.jobs)
      .values({
        userId,
        companyId: companyId.get(normalizeCompany(j.empresa)) ?? null,
        companyRaw: j.empresa,
        title: j.titulo,
        titleNormalized: normalizeTitle(j.titulo),
        locationRaw: j.ubicacion,
        countriesAllowed: j.paises,
        modality: enumValue(s.modality.enumValues, j.modalidad, "desconocida"),
        contractType: j.contrato,
        salaryMinUsd: j.salario?.min ?? null,
        salaryMaxUsd: j.salario?.max ?? null,
        salaryPeriod: j.salario?.periodo ?? null,
        salaryNote: j.salario?.nota ?? null,
        weeklyHours: weeklyHoursOf(j.contrato),
        candidatesCount: j.candidatos,
        badges: j.badges,
        skillsMatchRatio: skillsMatchRatio(j.badges),
        jdText: null,
        postedAt,
        firstSeenAt: postedAt,
        status: STATUS_BY_GOLDEN[j.estado] ?? "evaluada",
        flags,
        duplicateOfId: j.duplicate_of ? (jobIdByGolden.get(j.duplicate_of) ?? null) : null,
      })
      .returning({ id: s.jobs.id });
    const jobId = job!.id;
    jobIdByGolden.set(j.id, jobId);

    await db.insert(s.jobSources).values({
      jobId,
      kind: sourceKindOf(j.fuente),
      sourceName: "golden",
      externalId: String(j.id),
      rawRef: `golden.json#${j.id}`,
      seenAt: postedAt,
    });

    if (j.human_score !== null) {
      await db.insert(s.evaluations).values({
        jobId,
        userId,
        criteriaVersion: 1,
        promptVersion: `human@golden-${golden.meta.version}`,
        model: "human",
        hadFullJd: true,
        score: j.human_score,
        yearsRequired: j.anos,
        locationOk: enumValue(s.locationOk.enumValues, j.location_ok, "riesgo"),
        modality: enumValue(s.modality.enumValues, j.modalidad, "desconocida"),
        discipline: enumValue(s.discipline.enumValues, j.disciplina, "otra"),
        englishRequired: enumValue(s.englishLevel.enumValues, j.ingles, "no_menciona"),
        companyType: enumValue(s.companyType.enumValues, j.tipo_empresa, "desconocido"),
        matchFuerte: j.match,
        gaps: j.gaps,
        bloqueadoresDuros: j.bloqueadores,
        senalesPositivas: j.senales,
        veredicto: j.score_nota ?? j.notas ?? "",
        accion: enumValue(s.suggestedAction.enumValues, j.accion, "guardar"),
        raw: j,
        humanScore: j.human_score,
        humanNote: j.notas ?? null,
        createdAt: postedAt,
      });
    }

    const outcome = OUTCOME_BY_GOLDEN[j.estado];
    if (outcome) {
      await db.insert(s.applications).values({
        jobId,
        userId,
        appliedAt: postedAt,
        channel: channelOf(j.fuente),
        outcome,
        outcomeAt: outcome === "sin_respuesta" ? null : postedAt,
        outcomeNote: j.notas ?? null,
      });
    }
    inserted++;
  }
  // job_skills desde el campo stack (mapeo determinista por alias, adelanto de JS-030). Se
  // recalcula siempre: si cambian aliases o el golden, la próxima corrida del seed lo refleja.
  const taxonomy = await db
    .select({
      id: s.skills.id,
      slug: s.skills.slug,
      name: s.skills.name,
      aliases: s.skills.aliases,
    })
    .from(s.skills);
  const terms = compileTaxonomy(taxonomy);
  const skillIdBySlug = new Map(taxonomy.map((k) => [k.slug, k.id]));
  let skillRows = 0;
  const unmapped: string[] = [];
  for (const j of jobs) {
    const jobId = jobIdByGolden.get(j.id);
    if (!jobId || !j.stack.length) continue;
    const match = matchStack(j.stack, terms);
    unmapped.push(...match.unmapped);
    await db.delete(s.jobSkills).where(eq(s.jobSkills.jobId, jobId));
    if (match.mentions.length) {
      await db.insert(s.jobSkills).values(
        match.mentions.map((m) => ({
          jobId,
          skillId: skillIdBySlug.get(m.slug)!,
          isMust: m.isMust,
          rawMention: m.rawMention,
        })),
      );
      skillRows += match.mentions.length;
    }
  }
  console.log(
    `job_skills: ${skillRows} filas desde el stack del golden (${unmapped.length} menciones sin mapear)`,
  );
  return { inserted, skipped: jobs.length - inserted };
}

async function report(db: Db, userId: string): Promise<void> {
  const count = async (table: Parameters<Db["$count"]>[0], where?: Parameters<Db["$count"]>[1]) =>
    db.$count(table, where);
  const rows = {
    skills: await count(s.skills),
    learning_resources: await count(s.learningResources),
    model_routing: await count(s.modelRouting),
    companies: await count(s.companies),
    profiles: await count(s.profiles, eq(s.profiles.userId, userId)),
    evaluation_criteria: await count(s.evaluationCriteria, eq(s.evaluationCriteria.userId, userId)),
    talent_platforms: await count(s.talentPlatforms, eq(s.talentPlatforms.userId, userId)),
    jobs: await count(s.jobs, eq(s.jobs.userId, userId)),
    evaluations_human: await count(
      s.evaluations,
      and(eq(s.evaluations.userId, userId), eq(s.evaluations.model, "human")),
    ),
    applications: await count(s.applications, eq(s.applications.userId, userId)),
  };
  console.table(rows);
}

async function main(): Promise<void> {
  loadLocalEnv();
  const userId = process.env.SEED_USER_ID ?? DEFAULT_SEED_USER_ID;
  const url = requireDatabaseUrl({ purpose: "migration" });
  console.log(`→ ${describeDatabaseUrl(url)}`);
  // El seed reescribe perfil y golden: contra producción, solo confirmando (CLAUDE.md, regla 7)
  if (!(await confirmRemoteTarget(url, { action: "sembrar (reescribe perfil y golden)" }))) {
    console.error("db:seed cancelado: no se tocó la base.");
    process.exit(1);
  }
  const { db, close } = createDb(url);
  try {
    await seedCatalog(db);
    await seedUser(db, userId);
    const golden = await seedGolden(db, userId);
    console.log(`golden: ${golden.inserted} jobs insertados, ${golden.skipped} ya existían`);
    await report(db, userId);
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error("db:seed falló:", error);
  process.exit(1);
});
