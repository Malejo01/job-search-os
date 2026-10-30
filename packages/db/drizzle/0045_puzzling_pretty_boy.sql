CREATE TABLE "beta_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"message" text NOT NULL,
	"path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "beta_feedback_category" CHECK ("beta_feedback"."category" in ('algo_no_anduvo', 'idea', 'confuso')),
	CONSTRAINT "beta_feedback_message_length" CHECK (char_length("beta_feedback"."message") between 1 and 2000),
	CONSTRAINT "beta_feedback_path_length" CHECK (char_length("beta_feedback"."path") <= 200)
);
--> statement-breakpoint
ALTER TABLE "beta_feedback" ADD CONSTRAINT "beta_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "beta_feedback_user_created" ON "beta_feedback" USING btree ("user_id","created_at");