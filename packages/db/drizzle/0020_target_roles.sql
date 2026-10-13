ALTER TABLE "jobs" ADD COLUMN "matched_role" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "target_roles" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "max_target_roles" integer;