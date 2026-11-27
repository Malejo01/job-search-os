ALTER TYPE "public"."source_kind" ADD VALUE 'reliefweb';--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "salary_original_min" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "salary_original_max" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "salary_original_currency" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "salary_original_period" text;--> statement-breakpoint
ALTER TABLE "public_jobs" ADD COLUMN "salary_original_min" integer;--> statement-breakpoint
ALTER TABLE "public_jobs" ADD COLUMN "salary_original_max" integer;--> statement-breakpoint
ALTER TABLE "public_jobs" ADD COLUMN "salary_original_currency" text;--> statement-breakpoint
ALTER TABLE "public_jobs" ADD COLUMN "salary_original_period" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_salary_original_shape" CHECK ((("jobs"."salary_original_min" is null and "jobs"."salary_original_max" is null) or ("jobs"."salary_original_currency" is not null and "jobs"."salary_original_currency" ~ '^[A-Z]{3}$')) and ("jobs"."salary_original_period" is null or "jobs"."salary_original_period" in ('mensual', 'anual', 'hora')));--> statement-breakpoint
ALTER TABLE "public_jobs" ADD CONSTRAINT "public_jobs_salary_original_shape" CHECK ((("public_jobs"."salary_original_min" is null and "public_jobs"."salary_original_max" is null) or ("public_jobs"."salary_original_currency" is not null and "public_jobs"."salary_original_currency" ~ '^[A-Z]{3}$')) and ("public_jobs"."salary_original_period" is null or "public_jobs"."salary_original_period" in ('mensual', 'anual', 'hora')));