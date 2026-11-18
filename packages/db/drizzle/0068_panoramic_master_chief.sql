ALTER TYPE "public"."source_kind" ADD VALUE 'workable';--> statement-breakpoint
ALTER TABLE "ats_boards" DROP CONSTRAINT "ats_boards_provider_check";--> statement-breakpoint
ALTER TABLE "ats_boards" ADD CONSTRAINT "ats_boards_provider_check" CHECK ("ats_boards"."provider" in ('greenhouse', 'lever', 'ashby', 'teamtailor', 'workable'));