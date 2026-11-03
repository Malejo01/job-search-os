CREATE TABLE "market_candidates" (
	"user_id" uuid NOT NULL,
	"term" text NOT NULL,
	"count" integer NOT NULL,
	"source_latest_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_candidates_user_id_term_pk" PRIMARY KEY("user_id","term"),
	CONSTRAINT "market_candidates_term_length" CHECK (char_length("market_candidates"."term") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "public_jobs" ADD COLUMN "jd_language" text;--> statement-breakpoint
ALTER TABLE "public_jobs" ADD COLUMN "english_language" text;--> statement-breakpoint
ALTER TABLE "public_jobs" ADD COLUMN "english_asks" boolean;--> statement-breakpoint
ALTER TABLE "public_jobs" ADD COLUMN "english_level" text;--> statement-breakpoint
ALTER TABLE "public_jobs" ADD COLUMN "language_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "market_candidates" ADD CONSTRAINT "market_candidates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_user_created" ON "jobs" USING btree ("user_id","created_at" DESC NULLS LAST);