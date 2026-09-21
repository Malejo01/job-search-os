import {
  pgTable, pgEnum, uuid, text, integer, real, boolean, timestamp, jsonb, date, index, uniqueIndex, primaryKey,
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
  "ai_engineer", "ml_engineer", "ai_evaluation", "fullstack", "frontend", "backend", "devops",
  "data", "ciberseguridad", "negocio", "project_management", "administracion_plataformas", "arquitectura", "otra",
]);
export const locationOk = pgEnum("location_ok", ["ok", "riesgo", "no"]);
export const suggestedAction = pgEnum("suggested_action", ["aplicar_personalizado", "aplicar", "guardar", "descartar"]);
export const englishLevel = pgEnum("english_level", ["no_menciona", "no", "basico", "intermedio", "avanzado", "nativo"]);
export const companyType = pgEnum("company_type", ["producto", "startup", "consultora", "staffing", "agencia", "desconocido"]);
export const sourceKind = pgEnum("source_kind", ["getonboard_api", "email_linkedin", "email_getonboard", "email_generic", "manual", "hn_whoishiring", "remotive", "other"]);
export const applicationOutcome = pgEnum("application_outcome", [
  "sin_respuesta", "rechazo_automatico_ubicacion", "rechazo_automatico_otro", "rechazo_humano", "entrevista", "oferta", "cerrada_antes", "retirada",
]);
export const skillCategory = pgEnum("skill_category", ["cloud", "infra", "testing", "llm_ops", "ai_core", "lenguaje", "framework", "datos", "soft", "idioma", "dominio", "otra"]);
export const evidenceType = pgEnum("evidence_type", ["repo", "certificacion", "proyecto_produccion", "experiencia_laboral", "respuesta_entrevista", "test_externo", "otra"]);
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
  remoteOnly: boolean("remote_only").notNull().default(true),
  workAuth: jsonb("work_auth").$type<{ us: boolean; eu: boolean; other?: string[] }>().notNull().default({ us: false, eu: false }),
  yearsTotal: real("years_total"),
  yearsEnterprise: real("years_enterprise"),
  englishCefr: text("english_cefr"),          // A1..C2, verificable con EF SET
  salaryFloorUsd: integer("salary_floor_usd"), // mensual, remoto senior
  maxWeeklyHours: integer("max_weekly_hours").default(40),
  inboundAddress: text("inbound_address").notNull().unique(), // u_<id>@ingest.<dominio>
  timezone: text("timezone").default("America/Argentina/Salta"),
  profileSummary: text("profile_summary"),    // texto que entra al prompt (generado desde skill_levels + proyectos)
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

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
  ml_engineer_keywords: string[];       // fine-tuning, lora, peft, pytorch, tensorflow, sagemaker
  ai_eval_keywords: string[];           // eval harness, llm-as-judge, red-teaming, golden dataset
  other_discipline_keywords: string[];  // iam, sailpoint, seo, growth, pmp ...
  cloud_must_penalty: number;           // -1
  english_fluent_penalty: number;       // -1
  easy_apply_penalty: number;           // 0 (solo flag)
  skills_match_badge: { analyze_from: number; discard_below: number }; // 0.6, 0.4
  salary_floor_usd_monthly: number;     // piso mensual en USD
  max_weekly_hours: number;             // 40
  thresholds: { personalizado: number; aplicar: number; guardar: number }; // 9, 7, 5
};

// ─────────────────────────────────────────────────────────────
// Ofertas
// ─────────────────────────────────────────────────────────────
export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  nameNormalized: text("name_normalized").notNull().unique(), // lower, sin sufijos (inc, srl, sa, labs)
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
  uniqueIndex("jobs_user_url").on(t.userId, t.canonicalUrl),
]);

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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("evaluations_job").on(t.jobId), index("evaluations_user_score").on(t.userId, t.score)]);

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
}, (t) => [index("applications_user_outcome").on(t.userId, t.outcome)]);

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
  name: text("name").notNull(),             // HireLATAM, Simera, Turing ...
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
});

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
});

// JS-038: emails que el webhook rechazó por el límite horario (no se guardan; esto los cuenta)
export const inboundRejections = pgTable("inbound_rejections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(), // hora truncada
  rejected: integer("rejected").notNull().default(0),
  lastAt: timestamp("last_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("inbound_rejections_user_window").on(t.userId, t.windowStart)]);
