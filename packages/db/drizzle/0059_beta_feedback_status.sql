ALTER TABLE "beta_feedback" ADD COLUMN "status" text DEFAULT 'nuevo' NOT NULL;--> statement-breakpoint
ALTER TABLE "beta_feedback" ADD COLUMN "status_changed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "beta_feedback_created" ON "beta_feedback" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "beta_feedback" ADD CONSTRAINT "beta_feedback_status_check" CHECK ("beta_feedback"."status" in ('nuevo', 'visto', 'resuelto'));