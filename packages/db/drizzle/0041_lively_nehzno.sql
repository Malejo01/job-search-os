ALTER TYPE "public"."source_kind" ADD VALUE 'teamtailor';--> statement-breakpoint
ALTER TABLE "ats_boards" DROP CONSTRAINT "ats_boards_provider_check";--> statement-breakpoint
ALTER TABLE "ats_boards" DROP CONSTRAINT "ats_boards_region_check";--> statement-breakpoint
ALTER TABLE "ats_boards" ADD CONSTRAINT "ats_boards_provider_check" CHECK ("ats_boards"."provider" in ('greenhouse', 'lever', 'ashby', 'teamtailor'));--> statement-breakpoint
ALTER TABLE "ats_boards" ADD CONSTRAINT "ats_boards_region_check" CHECK ("ats_boards"."region" is null or ("ats_boards"."provider" = 'lever' and "ats_boards"."region" = 'eu') or ("ats_boards"."provider" = 'teamtailor' and "ats_boards"."region" = 'na'));