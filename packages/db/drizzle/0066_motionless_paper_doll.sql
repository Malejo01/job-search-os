ALTER TABLE "career_history" DROP CONSTRAINT "career_history_kind";--> statement-breakpoint
ALTER TABLE "career_history" ADD COLUMN "link" text;--> statement-breakpoint
ALTER TABLE "career_history" ADD CONSTRAINT "career_history_link" CHECK ("career_history"."link" is null or ("career_history"."link" ~ '^https://' and char_length("career_history"."link") <= 200));--> statement-breakpoint
ALTER TABLE "career_history" ADD CONSTRAINT "career_history_kind" CHECK ("career_history"."kind" in ('trabajo', 'educacion', 'certificacion', 'proyecto'));