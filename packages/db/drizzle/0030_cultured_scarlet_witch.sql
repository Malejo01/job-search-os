CREATE TABLE "demo_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_key" text NOT NULL,
	"public_job_id" uuid NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"score" real NOT NULL,
	"score_model" real NOT NULL,
	"accion" text NOT NULL,
	"match_fuerte" text[] DEFAULT '{}'::text[] NOT NULL,
	"gaps" text[] DEFAULT '{}'::text[] NOT NULL,
	"bloqueadores" text[] DEFAULT '{}'::text[] NOT NULL,
	"riesgos" text[] DEFAULT '{}'::text[] NOT NULL,
	"veredicto" text NOT NULL,
	"location_ok" text NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "demo_evaluations_profile_check" CHECK ("demo_evaluations"."profile_key" in ('data_analyst_jr', 'fullstack_ssr', 'ai_engineer'))
);
--> statement-breakpoint
ALTER TABLE "demo_evaluations" ADD CONSTRAINT "demo_evaluations_public_job_id_public_jobs_id_fk" FOREIGN KEY ("public_job_id") REFERENCES "public"."public_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "demo_evaluations_profile_job" ON "demo_evaluations" USING btree ("profile_key","public_job_id");