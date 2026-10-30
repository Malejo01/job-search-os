CREATE TABLE "career_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"organization" text NOT NULL,
	"title" text NOT NULL,
	"start_month" text,
	"end_month" text,
	"bullets" text[] DEFAULT '{}'::text[] NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "career_history_kind" CHECK ("career_history"."kind" in ('trabajo', 'educacion', 'certificacion')),
	CONSTRAINT "career_history_source" CHECK ("career_history"."source" in ('manual', 'cv', 'chat')),
	CONSTRAINT "career_history_organization_length" CHECK (char_length("career_history"."organization") between 1 and 120),
	CONSTRAINT "career_history_title_length" CHECK (char_length("career_history"."title") between 1 and 120),
	CONSTRAINT "career_history_start_month" CHECK ("career_history"."start_month" is null or "career_history"."start_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "career_history_end_month" CHECK ("career_history"."end_month" is null or "career_history"."end_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "career_history_bullets" CHECK (coalesce(cardinality("career_history"."bullets"), 0) <= 6 and char_length(array_to_string("career_history"."bullets", E'
')) <= 1500)
);
--> statement-breakpoint
ALTER TABLE "career_history" ADD CONSTRAINT "career_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "career_history_user_sort" ON "career_history" USING btree ("user_id","sort");