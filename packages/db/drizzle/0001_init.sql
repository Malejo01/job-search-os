CREATE TYPE "public"."application_outcome" AS ENUM('sin_respuesta', 'rechazo_automatico_ubicacion', 'rechazo_automatico_otro', 'rechazo_humano', 'entrevista', 'oferta', 'cerrada_antes', 'retirada');--> statement-breakpoint
CREATE TYPE "public"."company_type" AS ENUM('producto', 'startup', 'consultora', 'staffing', 'agencia', 'desconocido');--> statement-breakpoint
CREATE TYPE "public"."discipline" AS ENUM('ai_engineer', 'ml_engineer', 'ai_evaluation', 'fullstack', 'frontend', 'backend', 'devops', 'data', 'ciberseguridad', 'negocio', 'project_management', 'administracion_plataformas', 'arquitectura', 'otra');--> statement-breakpoint
CREATE TYPE "public"."english_level" AS ENUM('no_menciona', 'no', 'basico', 'intermedio', 'avanzado', 'nativo');--> statement-breakpoint
CREATE TYPE "public"."evidence_type" AS ENUM('repo', 'certificacion', 'proyecto_produccion', 'experiencia_laboral', 'respuesta_entrevista', 'test_externo', 'otra');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('nueva', 'prefiltrada', 'descartada_prefiltro', 'pendiente_jd', 'evaluada', 'aplicada', 'descartada', 'rechazo_automatico', 'rechazada', 'entrevista', 'oferta', 'cerrada');--> statement-breakpoint
CREATE TYPE "public"."location_ok" AS ENUM('ok', 'riesgo', 'no');--> statement-breakpoint
CREATE TYPE "public"."modality" AS ENUM('remoto', 'hibrido', 'presencial', 'desconocida');--> statement-breakpoint
CREATE TYPE "public"."skill_category" AS ENUM('cloud', 'infra', 'testing', 'llm_ops', 'ai_core', 'lenguaje', 'framework', 'datos', 'soft', 'idioma', 'dominio', 'otra');--> statement-breakpoint
CREATE TYPE "public"."skill_claim_state" AS ENUM('respaldada', 'parcial', 'sin_evidencia');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('getonboard_api', 'email_linkedin', 'email_getonboard', 'email_generic', 'manual', 'hn_whoishiring', 'remotive', 'other');--> statement-breakpoint
CREATE TYPE "public"."suggested_action" AS ENUM('aplicar_personalizado', 'aplicar', 'guardar', 'descartar');--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"applied_at" timestamp with time zone,
	"channel" text,
	"salary_asked_usd" integer,
	"cover_note" text,
	"form_answers" jsonb,
	"outcome" "application_outcome" DEFAULT 'sin_respuesta',
	"outcome_at" timestamp with time zone,
	"outcome_note" text,
	"follow_up_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_normalized" text NOT NULL,
	"display_name" text NOT NULL,
	"type" "company_type" DEFAULT 'desconocido',
	"size" integer,
	"countries" text[],
	"notes" text,
	"glassdoor_rating" real,
	CONSTRAINT "companies_name_normalized_unique" UNIQUE("name_normalized")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid,
	"name" text NOT NULL,
	"role" text,
	"channel" text,
	"last_contact_at" timestamp with time zone,
	"status" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "evaluation_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"rules" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"criteria_version" integer NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"had_full_jd" boolean NOT NULL,
	"score" real NOT NULL,
	"years_required" integer,
	"location_ok" "location_ok" NOT NULL,
	"modality" "modality" NOT NULL,
	"discipline" "discipline" NOT NULL,
	"english_required" "english_level" DEFAULT 'no_menciona' NOT NULL,
	"company_type" "company_type" DEFAULT 'desconocido',
	"match_fuerte" text[] NOT NULL,
	"gaps" text[] NOT NULL,
	"bloqueadores_duros" text[] NOT NULL,
	"senales_positivas" text[] NOT NULL,
	"veredicto" text NOT NULL,
	"accion" "suggested_action" NOT NULL,
	"raw" jsonb,
	"human_score" real,
	"human_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"from_address" text NOT NULL,
	"subject" text,
	"raw_ref" text NOT NULL,
	"parser" text,
	"jobs_extracted" integer DEFAULT 0,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_skills" (
	"job_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"is_must" boolean NOT NULL,
	"raw_mention" text,
	CONSTRAINT "job_skills_job_id_skill_id_pk" PRIMARY KEY("job_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "job_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"kind" "source_kind" NOT NULL,
	"source_name" text,
	"external_id" text,
	"url" text,
	"raw_ref" text,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid,
	"company_raw" text NOT NULL,
	"title" text NOT NULL,
	"title_normalized" text NOT NULL,
	"canonical_url" text,
	"location_raw" text,
	"countries_allowed" text[],
	"modality" "modality" DEFAULT 'desconocida',
	"contract_type" text,
	"salary_min_usd" integer,
	"salary_max_usd" integer,
	"salary_period" text,
	"salary_note" text,
	"weekly_hours" integer,
	"candidates_count" integer,
	"badges" text[],
	"skills_match_ratio" real,
	"jd_text" text,
	"jd_hash" text,
	"jd_shingles" jsonb,
	"posted_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "job_status" DEFAULT 'nueva' NOT NULL,
	"prefilter_reason" text,
	"flags" text[],
	"duplicate_of_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"resource_id" uuid,
	"priority" real NOT NULL,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"started_at" date,
	"closed_at" date
);
--> statement-breakpoint
CREATE TABLE "learning_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"title" text NOT NULL,
	"provider" text NOT NULL,
	"url" text NOT NULL,
	"hours" integer,
	"cost_usd" real DEFAULT 0,
	"target_level" integer NOT NULL,
	"proposed_by_llm" boolean DEFAULT false NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"task" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text,
	"job_id" uuid,
	"tokens_in" integer,
	"tokens_out" integer,
	"latency_ms" integer,
	"cost_usd" real,
	"ok" boolean NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"skill_id" uuid NOT NULL,
	"mentions" integer NOT NULL,
	"must_mentions" integer NOT NULL,
	"weighted_demand" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_routing" (
	"task" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"fallback_model" text,
	"temperature" real DEFAULT 0,
	"max_tokens" integer DEFAULT 2048,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"headline" text,
	"location_country" text NOT NULL,
	"location_city" text,
	"remote_only" boolean DEFAULT true NOT NULL,
	"work_auth" jsonb DEFAULT '{"us":false,"eu":false}'::jsonb NOT NULL,
	"years_total" real,
	"years_enterprise" real,
	"english_cefr" text,
	"salary_floor_usd" integer,
	"max_weekly_hours" integer DEFAULT 40,
	"inbound_address" text NOT NULL,
	"timezone" text DEFAULT 'America/Argentina/Salta',
	"profile_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_inbound_address_unique" UNIQUE("inbound_address")
);
--> statement-breakpoint
CREATE TABLE "skill_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"type" "evidence_type" NOT NULL,
	"url" text,
	"description" text NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"proposed_level" integer,
	"approved_by_user" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_levels" (
	"user_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"confidence" real NOT NULL,
	"state" "skill_claim_state" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_levels_user_id_skill_id_pk" PRIMARY KEY("user_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category" "skill_category" NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"closure_hours" integer,
	"is_global" boolean DEFAULT true NOT NULL,
	CONSTRAINT "skills_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "talent_platforms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"status" text NOT NULL,
	"profile_updated_at" date,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_skills" ADD CONSTRAINT "job_skills_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_skills" ADD CONSTRAINT "job_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sources" ADD CONSTRAINT "job_sources_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_plan_items" ADD CONSTRAINT "learning_plan_items_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_plan_items" ADD CONSTRAINT "learning_plan_items_resource_id_learning_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."learning_resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_resources" ADD CONSTRAINT "learning_resources_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_snapshots" ADD CONSTRAINT "market_snapshots_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_evidence" ADD CONSTRAINT "skill_evidence_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_interviews" ADD CONSTRAINT "skill_interviews_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_levels" ADD CONSTRAINT "skill_levels_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_user_outcome" ON "applications" USING btree ("user_id","outcome");--> statement-breakpoint
CREATE UNIQUE INDEX "criteria_user_version" ON "evaluation_criteria" USING btree ("user_id","version");--> statement-breakpoint
CREATE INDEX "evaluations_job" ON "evaluations" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "evaluations_user_score" ON "evaluations" USING btree ("user_id","score");--> statement-breakpoint
CREATE INDEX "job_sources_job" ON "job_sources" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "jobs_user_status" ON "jobs" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "jobs_user_company" ON "jobs" USING btree ("user_id","company_id","first_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_user_url" ON "jobs" USING btree ("user_id","canonical_url");--> statement-breakpoint
CREATE INDEX "llm_calls_user_task" ON "llm_calls" USING btree ("user_id","task","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "market_user_week_skill" ON "market_snapshots" USING btree ("user_id","week_start","skill_id");