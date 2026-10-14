CREATE TYPE "public"."human_verdict" AS ENUM('de_acuerdo', 'en_desacuerdo');--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "human_verdict" "human_verdict";--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "human_verdict_at" timestamp with time zone;