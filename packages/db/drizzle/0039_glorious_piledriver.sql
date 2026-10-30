ALTER TABLE "profiles" ADD COLUMN "plan" text DEFAULT 'gratis' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "plan_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_plan_check" CHECK ("profiles"."plan" in ('gratis', 'fundador', 'lista', 'pase_3_meses'));