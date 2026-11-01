import { sql } from "drizzle-orm";
import type { FeedbackContext } from "@job-search-os/pipeline";
import {
  pgTable, pgEnum, uuid, text, integer, smallint, real, boolean, timestamp, jsonb, date, index, uniqueIndex, primaryKey, check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────
export const jobStatus = pgEnum("job_status", [
  "nueva", "prefiltrada", "descartada_prefiltro", "pendiente_jd", "evaluada",
  "aplicada", "descartada", "rechazo_automatico", "rechazada", "entrevista", "oferta", "cerrada",
]);
export const modality = pgEnum("modality", ["remoto", "hibrido", "presencial", "desconocida"]);
export const discipline = pgEnum("discipline", [
  "ai_engineer", "ml_engineer", "ai_evaluation", "creative_production", "fullstack", "frontend", "backend", "devops",
  "data", "ciberseguridad", "negocio", "project_management", "administracion_plataformas", "arquitectura", "otra",
  "marketing_digital", "producto", "recursos_humanos", "customer_success",
]);
export const locationOk = pgEnum("location_ok", ["ok", "riesgo", "no"]);
export const suggestedAction = pgEnum("suggested_action", ["aplicar_personalizado", "aplicar", "guardar", "descartar"]);
export const englishLevel = pgEnum("english_level", ["no_menciona", "no", "basico", "intermedio", "avanzado", "nativo"]);
export const companyType = pgEnum("company_type", ["producto", "startup", "consultora", "staffing", "agencia", "desconocido"]);
export const sourceKind = pgEnum("source_kind", ["getonboard_api", "email_linkedin", "email_getonboard", "email_generic", "manual", "hn_whoishiring", "remotive", "other", "remoteok", "jobicy", "himalayas", "wwr", "greenhouse", "lever", "ashby", "teamtailor", "computrabajo_alerts"]);
export const applicationOutcome = pgEnum("application_outcome", [
  "sin_respuesta", "rechazo_automatico_ubicacion", "rechazo_automatico_otro", "rechazo_humano", "entrevista", "oferta", "cerrada_antes", "retirada",
]);
export const skillCategory = pgEnum("skill_category", ["cloud", "infra", "testing", "llm_ops", "ai_core", "lenguaje", "framework", "datos", "soft", "idioma", "dominio", "otra"]);
export const evidenceType = pgEnum("evidence_type", ["repo", "certificacion", "proyecto_produccion", "experiencia_laboral", "respuesta_entrevista", "test_externo", "otra"]);
export const humanVerdict = pgEnum("human_verdict", ["de_acuerdo", "en_desacuerdo"]);
export const skillState = pgEnum("skill_claim_state", ["respaldada", "parcial", "sin_evidencia"]);

// ─────────────────────────────────────────────────────────────
// Usuarios y perfil
// ─────────────────────────────────────────────────────────────
// Usuarios de Auth.js (ADR-010): un solo usuario en fase 1, Credentials (email + contraseña con
// scrypt en password_hash). Sin registro público: el seed crea el usuario. profiles.user_id y el
// resto de user_id referencian users.id lógicamente (la FK se difiere: el seed corre después de migrar).
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  name: text("name"),
  passwordHash: text("password_hash"),
  // Aceptación de términos (JS-106): fecha y versión vigente al registrarse; NULL = cuenta anterior.
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  termsVersion: text("terms_version"),
  // S-6: va en el JWT al iniciar sesión. Al resetear la contraseña sube, y las sesiones viejas dejan
  // de valer (requireUserId compara las dos). Un JWT sin versión cuenta como 0
  sessionVersion: integer("session_version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("users_email").on(t.email)]);

// Recuperación de contraseña (JS-045): token de un solo uso, se guarda hasheado (sha256);
// el valor en claro solo vive en el link del email. TTL corto (packages/db/src/password-reset-token.ts).
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("password_reset_tokens_hash").on(t.tokenHash),
  index("password_reset_tokens_user").on(t.userId),
]);

export const profiles = pgTable("profiles", {
  userId: uuid("user_id").primaryKey(), // = auth.users.id
  displayName: text("display_name").notNull(),
  headline: text("headline"),                 // "AI Engineer / Fullstack"
  locationCountry: text("location_country").notNull(), // ISO-2
  locationCity: text("location_city"),
  remoteOnly: boolean("remote_only").notNull().default(true), // derivado de accepted_modalities: true si solo acepta remoto
  acceptedModalities: text("accepted_modalities").array().notNull().default(sql`'{remoto}'::text[]`), // remoto | hibrido | presencial; se validan en código
  jobLanguages: text("job_languages").array().notNull().default(sql`'{es,en}'::text[]`), // idiomas de aviso que acepta: es | en
  workAuth: jsonb("work_auth").$type<{ us: boolean; eu: boolean; other?: string[] }>().notNull().default({ us: false, eu: false }),
  yearsTotal: real("years_total"),
  yearsEnterprise: real("years_enterprise"),
  englishCefr: text("english_cefr"),          // A1..C2, verificable con EF SET
  salaryFloorUsd: integer("salary_floor_usd"), // mensual, remoto senior
  maxWeeklyHours: integer("max_weekly_hours").default(40),
  inboundAddress: text("inbound_address").notNull().unique(), // u_<id>@ingest.<dominio>
  timezone: text("timezone").default("America/Argentina/Salta"),
  profileSummary: text("profile_summary"),    // texto que entra al prompt (generado desde skill_levels + proyectos)
  targetRole: text("target_role"),            // puesto principal (el primero de target_roles); se escribe siempre junto con la lista
  targetRoles: text("target_roles").array().notNull().default(sql`'{}'::text[]`), // puestos elegidos (ADR-016): se validan en código contra ROLE_KEYS
  maxTargetRoles: integer("max_target_roles"), // tope de puestos del perfil; null = rige TARGET_ROLES_FREE_LIMIT
  poolDailyEvalLimit: integer("pool_daily_eval_limit"), // tope diario de evaluaciones del pool; null = rige el default de la variable
  // Plan de la beta paga (C-11b): claves de PLAN_KEYS (pipeline/src/plans.ts). Lo cambia el dueño con un
  // UPDATE puntual; la app no puede (trigger en rls/0010_plan.sql). plan_until null = sin vencimiento
  plan: text("plan").notNull().default("gratis"),
  planUntil: timestamp("plan_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("profiles_plan_check", sql`${t.plan} in ('gratis', 'fundador', 'lista', 'pase_3_meses')`),
]);

export const evaluationCriteria = pgTable("evaluation_criteria", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  version: integer("version").notNull(),
  active: boolean("active").notNull().default(true),
  // Reglas del prefiltro y penalizaciones; ver docs/EVALUATOR_PROMPT_v1.md §3
  rules: jsonb("rules").$type<CriteriaRules>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("criteria_user_version").on(t.userId, t.version)]);

export type CriteriaRules = {
  title_blocklist: string[];            // ["lead","manager","director","head of","principal","architect","tech lead"]
  title_allowlist: string[];            // ["agent architect"]
  title_cap_score: number;              // 3
  title_cap_score_if_few_candidates: { max_candidates: number; cap: number; disciplines: string[] }; // {5, 5, ["ai_engineer"]}
  max_years_hard: number;               // 8
  years_penalty: { from: number; to: number; penalty: number }; // 5-7 → -2
  // Gap contra los años del candidato (JS-052): por defecto solo riesgo, null desactiva el escalón
  years_gap: { risk_from: number | null; penalty_from: number | null; penalty: number; blocker_from: number | null };
  ml_engineer_keywords: string[];       // fine-tuning, lora, peft, pytorch, tensorflow, sagemaker
  ai_eval_keywords: string[];           // eval harness, llm-as-judge, red-teaming, golden dataset
  other_discipline_keywords: string[];  // iam, sailpoint, seo, growth, pmp ...
  allowed_disciplines: string[];        // disciplinas del perfil; fuera de la lista = bloqueador (JS-052)
  discipline_cap_score: number;         // 4: tope del score con disciplina distinta
  english_risk_from: "basico" | "intermedio" | "avanzado" | "nativo"; // "avanzado": desde ahí es riesgo
  cloud_must_penalty: number;           // -1
  english_fluent_penalty: number;       // -1
  easy_apply_penalty: number;           // 0 (solo flag)
  skills_match_badge: { analyze_from: number; discard_below: number }; // 0.6, 0.4
  salary_floor_usd_monthly: number | null; // piso mensual en USD; null = no se cargó (sin penalización por sueldo)
  max_weekly_hours: number;             // 40
  thresholds: { personalizado: number; aplicar: number; guardar: number }; // 9, 7, 5
};

// ─────────────────────────────────────────────────────────────
// Ofertas
// ─────────────────────────────────────────────────────────────
export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  nameNormalized: text("name_normalized").notNull().unique(), // lower, sin sufijos legales (inc, srl, sa)
  displayName: text("display_name").notNull(),
  type: companyType("type").default("desconocido"),
  size: integer("size"),
  countries: text("countries").array(),   // países donde contratan, si se conoce
  notes: text("notes"),
  glassdoorRating: real("glassdoor_rating"),
});

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  companyId: uuid("company_id").references(() => companies.id),
  companyRaw: text("company_raw").notNull(),
  title: text("title").notNull(),
  titleNormalized: text("title_normalized").notNull(), // tokens sin seniority/stopwords, para Jaccard
  canonicalUrl: text("canonical_url"),                  // sin params de tracking
  locationRaw: text("location_raw"),
  countriesAllowed: text("countries_allowed").array(), // null = desconocido
  modality: modality("modality").default("desconocida"),
  contractType: text("contract_type"),
  salaryMinUsd: integer("salary_min_usd"),
  salaryMaxUsd: integer("salary_max_usd"),
  salaryPeriod: text("salary_period"),                  // mensual | anual | hora
  salaryNote: text("salary_note"),
  weeklyHours: integer("weekly_hours"),
  candidatesCount: integer("candidates_count"),
  // Oferta del pool de la que salió esta copia por usuario (ADR-014); null = ingesta directa
  publicJobId: uuid("public_job_id").references((): AnyPgColumn => publicJobs.id, { onDelete: "set null" }),
  // Puesto elegido por el que se asignó la oferta del pool (ronda 45); null = sin señal o ingesta directa
  matchedRole: text("matched_role"),
  badges: text("badges").array(),                       // "En busca de personal", "Solicitud sencilla", "3 de 4 aptitudes"
  skillsMatchRatio: real("skills_match_ratio"),         // 0..1 desde badge "X de Y aptitudes"
  jdText: text("jd_text"),                              // null → pendiente_jd
  jdHash: text("jd_hash"),                              // sha256 del jd normalizado
  jdShingles: jsonb("jd_shingles").$type<string[]>(),   // 5-gramas muestreados para similitud
  postedAt: timestamp("posted_at", { withTimezone: true }),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
  status: jobStatus("status").notNull().default("nueva"),
  prefilterReason: text("prefilter_reason"),
  flags: text("flags").array(),                         // volume_recruiting, location_risk, closed_fast, stale_alert
  duplicateOfId: uuid("duplicate_of_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("jobs_user_status").on(t.userId, t.status),
  index("jobs_user_company").on(t.userId, t.companyId, t.firstSeenAt),
  // C-7: orden y filtro por fecha de la lista (/jobs, «Hoy»)
  index("jobs_user_first_seen").on(t.userId, t.firstSeenAt.desc()),
  uniqueIndex("jobs_user_url").on(t.userId, t.canonicalUrl),
  uniqueIndex("jobs_user_public_job").on(t.userId, t.publicJobId).where(sql`${t.publicJobId} is not null`),
]);

// Pool global de ofertas públicas (ADR-014). Son ofertas, no datos de usuarios: nada por persona
// (estado, flags, prefiltro, evaluaciones) va acá; eso vive en `jobs`. Sin user_id.
export const publicJobs = pgTable("public_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceKind: sourceKind("source_kind").notNull(),
  externalId: text("external_id").notNull(),              // sin prefijo
  sourceName: text("source_name").notNull(),              // "Get on Board · programming", "Remote OK"...
  sourceUrl: text("source_url").notNull(),                // tal como la da la fuente (atribución)
  canonicalUrl: text("canonical_url"),
  title: text("title").notNull(),
  titleNormalized: text("title_normalized").notNull(),
  companyRaw: text("company_raw").notNull(),
  companyNormalized: text("company_normalized").notNull(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
  locationRaw: text("location_raw"),
  countriesAllowed: text("countries_allowed").array(),    // null = la fuente no lo dice
  modality: modality("modality").default("desconocida"),
  contractType: text("contract_type"),
  seniority: text("seniority"),
  lang: text("lang"),
  salaryMinUsd: integer("salary_min_usd"),
  salaryMaxUsd: integer("salary_max_usd"),
  salaryPeriod: text("salary_period"),                    // mensual | anual | hora
  salaryNote: text("salary_note"),
  weeklyHours: integer("weekly_hours"),
  candidatesCount: integer("candidates_count"),
  jdText: text("jd_text"),
  jdHash: text("jd_hash"),
  jdShingles: jsonb("jd_shingles").$type<string[]>(),
  tags: text("tags").array(),
  categories: text("categories").array(),                 // categoría o industria de la fuente
  roleHints: text("role_hints").array().notNull().default(sql`'{}'::text[]`), // roles de ROLE_KEYS; vacío = no se sabe
  postedAt: timestamp("posted_at", { withTimezone: true }),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  // Copia de otra fila del pool (la más antigua). No se fusiona: las dos filas quedan.
  dedupOfId: uuid("dedup_of_id").references((): AnyPgColumn => publicJobs.id, { onDelete: "set null" }),
  rawRef: text("raw_ref"),                                // raw_blobs con user_id NULL
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("public_jobs_source_external").on(t.sourceKind, t.externalId),
  index("public_jobs_posted_at").on(t.postedAt.desc()),
  index("public_jobs_last_seen").on(t.lastSeenAt),
  index("public_jobs_canonical_url").on(t.canonicalUrl).where(sql`${t.canonicalUrl} is not null`),
  index("public_jobs_jd_hash").on(t.jdHash).where(sql`${t.jdHash} is not null`),
  index("public_jobs_role_hints").using("gin", t.roleHints),
  index("public_jobs_dedup_of").on(t.dedupOfId).where(sql`${t.dedupOfId} is not null`),
]);

export const publicJobSkills = pgTable("public_job_skills", {
  publicJobId: uuid("public_job_id").notNull().references(() => publicJobs.id, { onDelete: "cascade" }),
  skillId: uuid("skill_id").notNull().references(() => skills.id),
  isMust: boolean("is_must").notNull(),
  rawMention: text("raw_mention"),
}, (t) => [
  primaryKey({ columns: [t.publicJobId, t.skillId] }),
  index("public_job_skills_skill").on(t.skillId),
]);

// Evaluaciones de la demo guiada (ronda 74): 3 perfiles inventados contra avisos reales del pool.
// Global, sin user_id. Lectura abierta (rls/0007); escribe solo el cron con la conexión de servicio.
export const demoEvaluations = pgTable("demo_evaluations", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileKey: text("profile_key").notNull(),
  publicJobId: uuid("public_job_id").notNull().references(() => publicJobs.id, { onDelete: "cascade" }),
  promptVersion: text("prompt_version").notNull(),
  model: text("model").notNull(),
  score: real("score").notNull(),                         // scoreFinal de decide()
  scoreModel: real("score_model").notNull(),
  accion: text("accion").notNull(),
  matchFuerte: text("match_fuerte").array().notNull().default(sql`'{}'::text[]`),
  gaps: text("gaps").array().notNull().default(sql`'{}'::text[]`),
  bloqueadores: text("bloqueadores").array().notNull().default(sql`'{}'::text[]`),
  riesgos: text("riesgos").array().notNull().default(sql`'{}'::text[]`),
  veredicto: text("veredicto").notNull(),                 // saneado
  locationOk: text("location_ok").notNull(),
  // Requisitos del aviso (buildChecklist). Null en las filas anteriores a la ronda 115: la web lo valida al leer
  checklist: jsonb("checklist"),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull(),
}, (t) => [
  uniqueIndex("demo_evaluations_profile_job").on(t.profileKey, t.publicJobId),
  check("demo_evaluations_profile_check", sql`${t.profileKey} in ('data_analyst_jr', 'fullstack_ssr', 'ai_engineer')`),
]);

// Bitácora global de descargas del pool: intervalos por fuente y auditoría. Solo la lee el servicio.
export const publicJobFetches = pgTable("public_job_fetches", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceKind: sourceKind("source_kind").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull(),                       // ok | partial | error | skipped
  httpStatus: integer("http_status"),
  fetched: integer("fetched").notNull().default(0),
  inserted: integer("inserted").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  errorCode: text("error_code"),                          // cerrado: timeout | http_429 | http_5xx | parse
  durationMs: integer("duration_ms"),
}, (t) => [index("public_job_fetches_source_started").on(t.sourceKind, t.startedAt)]);

// Boards públicos de ATS (Greenhouse, Lever, Ashby) que descarga el pool. Global, sin datos de
// personas. RLS sin policy (rls/0005): la app no la lee; la usa el cron con la conexión de servicio.
export const atsBoards = pgTable("ats_boards", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),                   // greenhouse | lever | ashby (check)
  token: text("token").notNull(),                         // slug del board: [a-z0-9-_.], máx. 100
  region: text("region"),                                 // solo lever: "eu" → api.eu.lever.co
  companyName: text("company_name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  notes: text("notes"),
  lastFetchAt: timestamp("last_fetch_at", { withTimezone: true }),
  lastStatus: text("last_status"),                        // cerrado: ok | código de error por board
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("ats_boards_provider_token").on(t.provider, t.token),
  check("ats_boards_provider_check", sql`${t.provider} in ('greenhouse', 'lever', 'ashby', 'teamtailor')`),
  // Defensa en profundidad (SSRF): el token va a una URL; la región solo existe en Lever
  check("ats_boards_token_check", sql`${t.token} ~* '^[a-z0-9][a-z0-9._-]{0,99}$'`),
  check("ats_boards_region_check", sql`${t.region} is null or (${t.provider} = 'lever' and ${t.region} = 'eu') or (${t.provider} = 'teamtailor' and ${t.region} = 'na')`),
]);

// Lista de espera de la vitrina pública (ronda 63): personas sin cuenta, por eso sin user_id. RLS sin
// policy (rls/0006): la app solo entra por waitlist_join(); el email se guarda normalizado.
export const waitlist = pgTable("waitlist", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),                         // lower(btrim()), único
  name: text("name").notNull(),
  role: text("role").notNull(),                           // clave de ROLE_KEYS (check; si cambia la lista, va una migración). `producto_proyectos` queda permitida hasta la contracción (ADR-019)
  heardFrom: text("heard_from"),
  ipHash: text("ip_hash"),                                // sha256 con sal; la función lo pone en null a las 24 h
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  invitedAt: timestamp("invited_at", { withTimezone: true }),   // ronda 70: cuándo el admin creó la invitación
  invitationId: uuid("invitation_id"),                    // sin FK a propósito: la purga puede borrar la invitación
}, (t) => [
  uniqueIndex("waitlist_email_unique").on(t.email),
  index("waitlist_ip_hash_created").on(t.ipHash, t.createdAt),
  index("waitlist_created").on(t.createdAt),
  check("waitlist_role_check", sql`${t.role} in ('frontend', 'backend', 'fullstack', 'qa', 'data_analyst', 'soporte_it', 'ai_engineer', 'ux_ui', 'marketing_digital', 'producto_proyectos', 'rrhh_it', 'customer_success', 'ciberseguridad', 'product_manager', 'product_owner', 'project_manager', 'product_marketing', 'data_engineer', 'solutions_engineer', 'ventas_b2b', 'atencion_cliente', 'finanzas_contabilidad', 'asistencia_operaciones', 'abogacia', 'administracion_empresas', 'comunicacion', 'relaciones_internacionales')`),
]);

// Administradores a nivel base (ronda 70): barrera de las funciones waitlist_admin_* (rls/0006). RLS sin
// policies: la app no la lee ni escribe; se carga con un INSERT puntual del dueño. Sin ella, ADMIN_EMAILS
// solo decide qué ve la UI.
export const appAdmins = pgTable("app_admins", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Agregados de demanda por rol y semana (global, sin user_id). Los usa /market.
export const roleMarketSnapshots = pgTable("role_market_snapshots", {
  role: text("role").notNull(),
  weekStart: date("week_start").notNull(),
  skillId: uuid("skill_id").notNull().references(() => skills.id),
  mentions: integer("mentions").notNull(),
  mustMentions: integer("must_mentions").notNull(),
  jobs: integer("jobs").notNull(),
}, (t) => [primaryKey({ columns: [t.role, t.weekStart, t.skillId] })]);

export const jobSources = pgTable("job_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  kind: sourceKind("kind").notNull(),
  sourceName: text("source_name"),          // "alerta AI Engineer", "GoB programming", "recruiter/Empresa A"
  externalId: text("external_id"),
  url: text("url"),
  rawRef: text("raw_ref"),                  // path en storage del email/JSON crudo
  seenAt: timestamp("seen_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("job_sources_job").on(t.jobId)]);

export const evaluations = pgTable("evaluations", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull(),
  criteriaVersion: integer("criteria_version").notNull(),
  promptVersion: text("prompt_version").notNull(),      // "evaluate_job@v1"
  model: text("model").notNull(),
  hadFullJd: boolean("had_full_jd").notNull(),
  score: real("score").notNull(),
  yearsRequired: integer("years_required"),
  yearsDomain: text("years_domain"),                    // v1.3.2: de QUÉ son esos años, texto del aviso
  yearsDiscipline: discipline("years_discipline"),      // v1.3.2: a qué disciplina pertenecen
  locationOk: locationOk("location_ok").notNull(),
  modality: modality("modality").notNull(),
  discipline: discipline("discipline").notNull(),
  englishRequired: englishLevel("english_required").notNull().default("no_menciona"),
  companyType: companyType("company_type").default("desconocido"),
  matchFuerte: text("match_fuerte").array().notNull(),
  gaps: text("gaps").array().notNull(),
  bloqueadoresDuros: text("bloqueadores_duros").array().notNull(),
  riesgos: text("riesgos").array().notNull().default([]),   // prompt v1.1+: riesgos no bloqueantes
  senalesPositivas: text("senales_positivas").array().notNull(),
  veredicto: text("veredicto").notNull(),
  accion: suggestedAction("accion").notNull(),          // calculada por código desde score + bloqueadores
  scoreModel: real("score_model"),                      // score tal cual lo devolvió el modelo (score = final tras decide())
  decision: jsonb("decision"),                          // ajustes aplicados por decide(): cap, penalizaciones, riesgos agregados
  raw: jsonb("raw"),                                    // JSON completo devuelto por el modelo
  humanScore: real("human_score"),                      // override / referencia humana
  humanNote: text("human_note"),
  humanVerdict: humanVerdict("human_verdict"),          // veredicto de un toque; null = sin opinión. No entra en el MAE ni en el snapshot
  humanVerdictAt: timestamp("human_verdict_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("evaluations_job").on(t.jobId),
  index("evaluations_user_score").on(t.userId, t.score),
  // C-7: «la última evaluación por oferta» (DISTINCT ON job_id … created_at desc) y la ventana de «Tu encaje»
  index("evaluations_job_created").on(t.jobId, t.createdAt.desc()),
  index("evaluations_user_created").on(t.userId, t.createdAt.desc()),
]);

export const applications = pgTable("applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  channel: text("channel"),                 // linkedin, getonboard, sitio_empresa, plataforma, recruiter
  salaryAskedUsd: integer("salary_asked_usd"),
  coverNote: text("cover_note"),
  formAnswers: jsonb("form_answers"),
  outcome: applicationOutcome("outcome").default("sin_respuesta"),
  outcomeAt: timestamp("outcome_at", { withTimezone: true }),
  outcomeNote: text("outcome_note"),
  followUpAt: date("follow_up_at"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("applications_user_outcome").on(t.userId, t.outcome),
  // C-7: FK sin índice; los joins de /applications y del informe de calibración van por acá
  index("applications_job").on(t.jobId),
]);

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  companyId: uuid("company_id").references(() => companies.id),
  name: text("name").notNull(),
  role: text("role"),
  channel: text("channel"),                 // linkedin, email
  lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
  status: text("status"),                   // abierto, sin_respuesta, cerrado
  notes: text("notes"),
});

export const talentPlatforms = pgTable("talent_platforms", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  name: text("name").notNull(),             // nombre de la plataforma (ej.: Plataforma A)
  url: text("url"),
  status: text("status").notNull(),         // pendiente, perfil_cargado, en_proceso, activo, descartada
  profileUpdatedAt: date("profile_updated_at"),
  notes: text("notes"),
});

// ─────────────────────────────────────────────────────────────
// Skills, evidencia y mercado
// ─────────────────────────────────────────────────────────────
export const skills = pgTable("skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),    // "aws", "docker", "ci_cd", "rag", "english_fluent"
  name: text("name").notNull(),
  category: skillCategory("category").notNull(),
  aliases: text("aliases").array().notNull().default([]),
  closureHours: integer("closure_hours"),   // horas estimadas para llegar a nivel 2 desde 0
  isGlobal: boolean("is_global").notNull().default(true),
  description: text("description"),         // una frase de qué es y para qué se usa ("¿Qué es?" de la pantalla de skills); sin LLM
});

export const jobSkills = pgTable("job_skills", {
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  skillId: uuid("skill_id").notNull().references(() => skills.id),
  isMust: boolean("is_must").notNull(),
  rawMention: text("raw_mention"),
}, (t) => [primaryKey({ columns: [t.jobId, t.skillId] })]);

export const skillLevels = pgTable("skill_levels", {
  userId: uuid("user_id").notNull(),
  skillId: uuid("skill_id").notNull().references(() => skills.id),
  level: integer("level").notNull(),        // 0 nulo · 1 básico · 2 productivo · 3 fuerte
  confidence: real("confidence").notNull(), // 0..1
  state: skillState("state").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.skillId] })]);

// Skills que la persona agrega a mano porque no están en la taxonomía (ronda 78). Son solo suyas:
// NO entran a `skills` ni a ningún prompt, al mercado o al plan. Máximo 30 por persona (en código).
// Único por (user_id, lower(name)).
export const userSkills = pgTable("user_skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  level: smallint("level").notNull(),       // 0 nulo · 1 básico · 2 productivo · 3 fuerte
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("user_skills_user_name").on(t.userId, sql`lower(${t.name})`),
  check("user_skills_level_range", sql`${t.level} between 0 and 3`),
  check("user_skills_name_length", sql`char_length(${t.name}) between 2 and 40`),
]);

// «Contanos qué pasó» (C-23, V4): comentarios de la beta desde la app. `path` es solo el pathname
// de la pantalla (sin query ni fragmento, que pueden traer ids). La persona inserta y lee lo suyo;
// el admin lee todo por `admin_beta_feedback()` (rls/0013). Sin UPDATE ni DELETE para la app. Se
// purga a los 180 días y se borra con la cuenta (cascade).
export const betaFeedback = pgTable("beta_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  message: text("message").notNull(),
  path: text("path").notNull(),
  context: jsonb("context").$type<FeedbackContext>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("beta_feedback_user_created").on(t.userId, t.createdAt),
  check("beta_feedback_category", sql`${t.category} in ('algo_no_anduvo', 'idea', 'confuso')`),
  check("beta_feedback_message_length", sql`char_length(${t.message}) between 1 and 2000`),
  check("beta_feedback_path_length", sql`char_length(${t.path}) <= 200`),
  check("beta_feedback_context_size", sql`${t.context} is null or octet_length(${t.context}::text) <= 4096`),
]);

// Historial laboral, de estudios y certificaciones confirmado por la persona (C-25, CVC-0; diseño de
// la ronda 100 §3.1.1). Es la fuente del CV: solo lo que la persona confirmó. No guarda teléfono,
// foto, fecha de nacimiento, documento ni dirección. Los topes finos (20 filas por persona, 6
// viñetas de hasta 220 caracteres, sin URLs) se validan en código; acá van los de forma. Policy en
// rls/0014; se borra con la cuenta.
export const careerHistory = pgTable("career_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),                // trabajo | educacion | certificacion
  organization: text("organization").notNull(), // empresa o institución
  title: text("title").notNull(),               // cargo o título
  startMonth: text("start_month"),              // 'AAAA-MM'
  endMonth: text("end_month"),                  // null = actual o no dice
  bullets: text("bullets").array().notNull().default(sql`'{}'::text[]`),
  source: text("source").notNull().default("manual"), // manual | cv | chat
  sort: integer("sort").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("career_history_user_sort").on(t.userId, t.sort),
  check("career_history_kind", sql`${t.kind} in ('trabajo', 'educacion', 'certificacion')`),
  check("career_history_source", sql`${t.source} in ('manual', 'cv', 'chat')`),
  check("career_history_organization_length", sql`char_length(${t.organization}) between 1 and 120`),
  check("career_history_title_length", sql`char_length(${t.title}) between 1 and 120`),
  check("career_history_start_month", sql`${t.startMonth} is null or ${t.startMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  check("career_history_end_month", sql`${t.endMonth} is null or ${t.endMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  check("career_history_bullets", sql`coalesce(cardinality(${t.bullets}), 0) <= 6 and char_length(array_to_string(${t.bullets}, E'\n')) <= 1500`),
]);

export const skillEvidence = pgTable("skill_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  skillId: uuid("skill_id").notNull().references(() => skills.id),
  type: evidenceType("type").notNull(),
  url: text("url"),
  description: text("description").notNull(),
  weight: real("weight").notNull().default(1), // repo con commits recientes 1.0 · cert 0.8 · respuesta 0.5
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const skillInterviews = pgTable("skill_interviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  skillId: uuid("skill_id").notNull().references(() => skills.id),
  question: text("question").notNull(),
  answer: text("answer"),
  proposedLevel: integer("proposed_level"),
  approvedByUser: boolean("approved_by_user").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const marketSnapshots = pgTable("market_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),        // agenda propia (según las ofertas que ese usuario ve)
  weekStart: date("week_start").notNull(),
  skillId: uuid("skill_id").notNull().references(() => skills.id),
  mentions: integer("mentions").notNull(),
  mustMentions: integer("must_mentions").notNull(),
  weightedDemand: real("weighted_demand").notNull(), // Σ score_oferta × (must ? 1 : 0.4)
}, (t) => [uniqueIndex("market_user_week_skill").on(t.userId, t.weekStart, t.skillId)]);

export const learningResources = pgTable("learning_resources", {
  id: uuid("id").primaryKey().defaultRandom(),
  skillId: uuid("skill_id").notNull().references(() => skills.id),
  title: text("title").notNull(),
  provider: text("provider").notNull(),
  url: text("url").notNull(),
  hours: integer("hours"),
  costUsd: real("cost_usd").default(0),
  targetLevel: integer("target_level").notNull(),
  proposedByLlm: boolean("proposed_by_llm").notNull().default(false),
  approved: boolean("approved").notNull().default(false),
  createdByUserId: uuid("created_by_user_id"),
});

export const learningPlanItems = pgTable("learning_plan_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  skillId: uuid("skill_id").notNull().references(() => skills.id),
  resourceId: uuid("resource_id").references(() => learningResources.id),
  priority: real("priority").notNull(),     // demanda_ponderada × (1 − nivel/3) × facilidad
  status: text("status").notNull().default("pendiente"), // pendiente, en_curso, cerrada
  startedAt: date("started_at"),
  closedAt: date("closed_at"),
}, (t) => [
  // C-7: el plan de cada persona, por prioridad (/plan y «Si aprendés…»)
  index("learning_plan_items_user_priority").on(t.userId, t.priority.desc()),
]);

// ─────────────────────────────────────────────────────────────
// Operación
// ─────────────────────────────────────────────────────────────
export const modelRouting = pgTable("model_routing", {
  task: text("task").primaryKey(),          // evaluate_job, extract_skills, judge_calibration, recruiter_message
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  fallbackModel: text("fallback_model"),
  temperature: real("temperature").default(0),
  maxTokens: integer("max_tokens").default(2048),
  // Razonamiento extendido: none | minimal | low | medium | high (vocabulario del AI SDK; null = default del proveedor).
  // Se factura como salida: en tareas de clasificación va en minimal (docs/LLM_COSTOS.md).
  thinkingLevel: text("thinking_level"),
  // Precio de lista por millón de tokens (USD) para estimar llm_calls.cost_usd; null = desconocido.
  // Los tokens de thinking/razonamiento se facturan como salida (Gemini y Anthropic): no hay tarifa aparte.
  inputUsdPerMtok: real("input_usd_per_mtok"),
  outputUsdPerMtok: real("output_usd_per_mtok"),
  fallbackInputUsdPerMtok: real("fallback_input_usd_per_mtok"),
  fallbackOutputUsdPerMtok: real("fallback_output_usd_per_mtok"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const llmCalls = pgTable("llm_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id"),
  task: text("task").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version"),
  jobId: uuid("job_id"),
  tokensIn: integer("tokens_in"),
  // tokens_out = todo lo facturado como salida (texto + thinking); tokens_reasoning = la parte de thinking
  tokensOut: integer("tokens_out"),
  tokensReasoning: integer("tokens_reasoning"),
  latencyMs: integer("latency_ms"),
  costUsd: real("cost_usd"),
  // Corridas de evals: task = eval:<prompt_version> y label = --label, para separarlas del gasto operativo
  label: text("label"),
  ok: boolean("ok").notNull(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("llm_calls_user_task").on(t.userId, t.task, t.createdAt)]);

// Cola de trabajo propia con SKIP LOCKED (pgmq no existe en Neon, ADR-009). Interfaz en adapters/queue.
export const jobQueue = pgTable("job_queue", {
  id: uuid("id").primaryKey().defaultRandom(),
  queue: text("queue").notNull(),                   // evaluate_job, extract_skills...
  userId: uuid("user_id"),                          // dueño del trabajo (RLS); los crons filtran explícito
  payload: jsonb("payload").notNull(),              // { jobId, ... }
  status: text("status").notNull().default("pending"), // pending | processing | done | failed
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  runAfter: timestamp("run_after", { withTimezone: true }).defaultNow().notNull(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("job_queue_pending").on(t.queue, t.status, t.runAfter)]);

// Crudos de ingesta (email completo tal como llegó): adapter `storage` sobre Postgres hoy, S3 mañana
// (ADR-007). raw_ref de inbound_emails apunta acá ("pg:<id>").
export const rawBlobs = pgTable("raw_blobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id"),
  kind: text("kind").notNull(),               // inbound_email
  contentType: text("content_type").notNull(),
  body: text("body").notNull(),
  bytes: integer("bytes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const inboundEmails = pgTable("inbound_emails", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id"),
  fromAddress: text("from_address").notNull(),
  subject: text("subject"),
  rawRef: text("raw_ref").notNull(),
  parser: text("parser"),                   // linkedin, getonboard, generic, none
  jobsExtracted: integer("jobs_extracted").default(0),
  error: text("error"),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  seenAt: timestamp("seen_at", { withTimezone: true }),          // JS-038: marcado como visto
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }), // JS-038: "no me sirve"
}, (t) => [
  // C-7: no tenía ningún índice; la bandeja, la cobertura de alertas de «Hoy» y «Primeros pasos» filtran así
  index("inbound_emails_user_received").on(t.userId, t.receivedAt.desc()),
]);

// JS-038: emails que el webhook rechazó por el límite horario (no se guardan; esto los cuenta)
export const inboundRejections = pgTable("inbound_rejections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(), // hora truncada
  rejected: integer("rejected").notNull().default(0),
  lastAt: timestamp("last_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("inbound_rejections_user_window").on(t.userId, t.windowStart)]);

// Lo que la persona decidió sobre un dominio remitente en el aviso de fuga del filtro (JS-048)
export const inboundSenderDomains = pgTable("inbound_sender_domains", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  domain: text("domain").notNull(),          // dominio base: banco.com.ar
  verdict: text("verdict").notNull(),        // empleo | no_empleo
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("inbound_sender_domains_user_domain").on(t.userId, t.domain)]);

// ─────────────────────────────────────────────────────────────
// Contexto para responder formularios de postulación (JS-053). Lo lee Claude por MCP; el
// servidor no llama a ningún modelo. Los datos reales se cargan con `pnpm applicant:sync`.
// ─────────────────────────────────────────────────────────────
// Hechos verificables del perfil: lo único que se puede afirmar en un formulario
export const candidateFacts = pgTable("candidate_facts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  key: text("key").notNull(),                  // estable: applicant:sync hace upsert por esta clave
  project: text("project").notNull(),
  claim: text("claim").notNull(),
  metric: text("metric"),
  source: text("source").notNull(),            // url o de dónde sale el dato
  verification: text("verification").notNull().default("verificable"), // verificable | autodeclarado
  active: boolean("active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("candidate_facts_user_key").on(t.userId, t.key)]);

// Respuestas fijas que no redacta un modelo. Sueldo, ubicación e inglés se leen de profiles.
export const applicationSettings = pgTable("application_settings", {
  userId: uuid("user_id").primaryKey(),
  availability: text("availability"),
  contract: text("contract"),                  // modalidad de contratación y plataformas de pago
  workAuthorization: text("work_authorization"),
  links: jsonb("links").$type<{ linkedin?: string; github?: string; portfolio?: string; cv?: string }>()
    .notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Respuestas aprobadas por la persona, reutilizables entre postulaciones
export const answerBank = pgTable("answer_bank", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  question: text("question").notNull(),
  questionNormalized: text("question_normalized").notNull(), // normalizeQuestion (pipeline)
  answer: text("answer").notNull(),
  lang: text("lang").notNull(),                // es | en
  sourceJobId: uuid("source_job_id").references(() => jobs.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("answer_bank_user_question_lang").on(t.userId, t.questionNormalized, t.lang)]);

// Lo que efectivamente se respondió en el formulario de una oferta (se reemplaza entero)
export const applicationAnswers = pgTable("application_answers", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("application_answers_job_position").on(t.jobId, t.position)]);

// Registro por invitación (JS-091): solo se guarda el sha256 del código; el valor en claro se
// muestra una sola vez al crearla. Sin columna user_id a propósito: la policy es por
// created_by_user_id y el canje pasa por register_with_invitation() (rls/0001_invitations.sql).
export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  codeHash: text("code_hash").notNull(),
  email: text("email"), // si viene, solo ese email puede canjearla
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().default(sql`now() + interval '14 days'`),
  usedAt: timestamp("used_at", { withTimezone: true }),
  usedByUserId: uuid("used_by_user_id"),
}, (t) => [
  uniqueIndex("invitations_code_hash").on(t.codeHash),
  index("invitations_created_by").on(t.createdByUserId),
]);
