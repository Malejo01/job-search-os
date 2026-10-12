ALTER TYPE "public"."source_kind" ADD VALUE 'remoteok';--> statement-breakpoint
ALTER TYPE "public"."source_kind" ADD VALUE 'jobicy';--> statement-breakpoint
ALTER TYPE "public"."source_kind" ADD VALUE 'himalayas';--> statement-breakpoint
CREATE TABLE "public_job_fetches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_kind" "source_kind" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"http_status" integer,
	"fetched" integer DEFAULT 0 NOT NULL,
	"inserted" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "public_job_skills" (
	"public_job_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"is_must" boolean NOT NULL,
	"raw_mention" text,
	CONSTRAINT "public_job_skills_public_job_id_skill_id_pk" PRIMARY KEY("public_job_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "public_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_kind" "source_kind" NOT NULL,
	"external_id" text NOT NULL,
	"source_name" text NOT NULL,
	"source_url" text NOT NULL,
	"canonical_url" text,
	"title" text NOT NULL,
	"title_normalized" text NOT NULL,
	"company_raw" text NOT NULL,
	"company_normalized" text NOT NULL,
	"company_id" uuid,
	"location_raw" text,
	"countries_allowed" text[],
	"modality" "modality" DEFAULT 'desconocida',
	"contract_type" text,
	"seniority" text,
	"lang" text,
	"salary_min_usd" integer,
	"salary_max_usd" integer,
	"salary_period" text,
	"salary_note" text,
	"weekly_hours" integer,
	"candidates_count" integer,
	"jd_text" text,
	"jd_hash" text,
	"jd_shingles" jsonb,
	"tags" text[],
	"categories" text[],
	"role_hints" text[] DEFAULT '{}'::text[] NOT NULL,
	"posted_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"dedup_of_id" uuid,
	"raw_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_market_snapshots" (
	"role" text NOT NULL,
	"week_start" date NOT NULL,
	"skill_id" uuid NOT NULL,
	"mentions" integer NOT NULL,
	"must_mentions" integer NOT NULL,
	"jobs" integer NOT NULL,
	CONSTRAINT "role_market_snapshots_role_week_start_skill_id_pk" PRIMARY KEY("role","week_start","skill_id")
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "public_job_id" uuid;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "target_role" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "pool_daily_eval_limit" integer;--> statement-breakpoint
ALTER TABLE "public_job_skills" ADD CONSTRAINT "public_job_skills_public_job_id_public_jobs_id_fk" FOREIGN KEY ("public_job_id") REFERENCES "public"."public_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_job_skills" ADD CONSTRAINT "public_job_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_jobs" ADD CONSTRAINT "public_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_jobs" ADD CONSTRAINT "public_jobs_dedup_of_id_public_jobs_id_fk" FOREIGN KEY ("dedup_of_id") REFERENCES "public"."public_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_market_snapshots" ADD CONSTRAINT "role_market_snapshots_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "public_job_fetches_source_started" ON "public_job_fetches" USING btree ("source_kind","started_at");--> statement-breakpoint
CREATE INDEX "public_job_skills_skill" ON "public_job_skills" USING btree ("skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "public_jobs_source_external" ON "public_jobs" USING btree ("source_kind","external_id");--> statement-breakpoint
CREATE INDEX "public_jobs_posted_at" ON "public_jobs" USING btree ("posted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "public_jobs_last_seen" ON "public_jobs" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "public_jobs_canonical_url" ON "public_jobs" USING btree ("canonical_url") WHERE "public_jobs"."canonical_url" is not null;--> statement-breakpoint
CREATE INDEX "public_jobs_jd_hash" ON "public_jobs" USING btree ("jd_hash") WHERE "public_jobs"."jd_hash" is not null;--> statement-breakpoint
CREATE INDEX "public_jobs_role_hints" ON "public_jobs" USING gin ("role_hints");--> statement-breakpoint
CREATE INDEX "public_jobs_dedup_of" ON "public_jobs" USING btree ("dedup_of_id") WHERE "public_jobs"."dedup_of_id" is not null;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_public_job_id_public_jobs_id_fk" FOREIGN KEY ("public_job_id") REFERENCES "public"."public_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_user_public_job" ON "jobs" USING btree ("user_id","public_job_id") WHERE "jobs"."public_job_id" is not null;