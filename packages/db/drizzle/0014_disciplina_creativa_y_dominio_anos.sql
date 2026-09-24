ALTER TYPE "public"."discipline" ADD VALUE 'creative_production' BEFORE 'fullstack';--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "years_domain" text;--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "years_discipline" "discipline";