CREATE TABLE "payment_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan" text NOT NULL,
	"operation_number" text,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "payment_notices_status" CHECK ("payment_notices"."status" in ('pendiente', 'activado', 'rechazado')),
	CONSTRAINT "payment_notices_plan_length" CHECK (char_length("payment_notices"."plan") between 1 and 40),
	CONSTRAINT "payment_notices_operation_number" CHECK ("payment_notices"."operation_number" is null or "payment_notices"."operation_number" ~ '^[0-9]{1,20}$'),
	CONSTRAINT "payment_notices_reject_reason" CHECK ("payment_notices"."reject_reason" is null or ("payment_notices"."status" = 'rechazado' and char_length("payment_notices"."reject_reason") between 1 and 200))
);
--> statement-breakpoint
ALTER TABLE "payment_notices" ADD CONSTRAINT "payment_notices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_notices_user_status" ON "payment_notices" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "payment_notices_status_created" ON "payment_notices" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "applications_created_at" ON "applications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "evaluations_created_at" ON "evaluations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "evaluations_verdict_at" ON "evaluations" USING btree ("human_verdict_at") WHERE "evaluations"."human_verdict_at" is not null;--> statement-breakpoint
CREATE INDEX "interview_sessions_created_at" ON "interview_sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "jobs_manual_created" ON "jobs" USING btree ("created_at") WHERE "jobs"."public_job_id" is null;