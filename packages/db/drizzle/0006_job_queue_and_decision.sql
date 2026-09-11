CREATE TABLE "job_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue" text NOT NULL,
	"user_id" uuid,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "riesgos" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "score_model" real;--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "decision" jsonb;--> statement-breakpoint
CREATE INDEX "job_queue_pending" ON "job_queue" USING btree ("queue","status","run_after");