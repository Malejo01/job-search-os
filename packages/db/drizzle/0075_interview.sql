CREATE TABLE "interview_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"answer" text NOT NULL,
	"clarity" smallint NOT NULL,
	"relevance" smallint NOT NULL,
	"star" smallint NOT NULL,
	"tip" text NOT NULL,
	"example" text NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interview_answers_position" CHECK ("interview_answers"."position" between 0 and 4),
	CONSTRAINT "interview_answers_scores" CHECK ("interview_answers"."clarity" between 0 and 10 and "interview_answers"."relevance" between 0 and 10 and "interview_answers"."star" between 0 and 10),
	CONSTRAINT "interview_answers_answer_length" CHECK (char_length("interview_answers"."answer") between 1 and 1500)
);
--> statement-breakpoint
CREATE TABLE "interview_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"job_id" uuid,
	"career" text,
	"seniority" text,
	"title" text NOT NULL,
	"questions" jsonb NOT NULL,
	"status" text DEFAULT 'en_curso' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "interview_sessions_source_kind" CHECK ("interview_sessions"."source_kind" in ('job', 'career')),
	CONSTRAINT "interview_sessions_status" CHECK ("interview_sessions"."status" in ('en_curso', 'terminada')),
	CONSTRAINT "interview_sessions_seniority" CHECK ("interview_sessions"."seniority" is null or "interview_sessions"."seniority" in ('trainee', 'junior', 'semi_senior', 'senior', 'lead')),
	CONSTRAINT "interview_sessions_career_length" CHECK ("interview_sessions"."career" is null or char_length("interview_sessions"."career") between 1 and 120),
	CONSTRAINT "interview_sessions_title_length" CHECK (char_length("interview_sessions"."title") between 1 and 200),
	CONSTRAINT "interview_sessions_questions" CHECK (jsonb_typeof("interview_sessions"."questions") = 'array' and jsonb_array_length("interview_sessions"."questions") = 5)
);
--> statement-breakpoint
ALTER TABLE "interview_answers" ADD CONSTRAINT "interview_answers_session_id_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."interview_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_answers" ADD CONSTRAINT "interview_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "interview_answers_session_position" ON "interview_answers" USING btree ("session_id","position");--> statement-breakpoint
CREATE INDEX "interview_answers_user" ON "interview_answers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "interview_sessions_user_created" ON "interview_sessions" USING btree ("user_id","created_at" DESC NULLS LAST);