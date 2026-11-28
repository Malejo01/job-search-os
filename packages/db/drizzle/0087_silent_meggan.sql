CREATE TABLE "job_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jd_hash" text NOT NULL,
	"status" text NOT NULL,
	"card" jsonb,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"prompt_version" text,
	"model" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"area" text,
	"jd_language" text,
	"english_level" text,
	"modality" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_cards_hash_shape" CHECK ("job_cards"."jd_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "job_cards_status" CHECK ("job_cards"."status" in ('lista', 'fallida', 'sin_texto')),
	CONSTRAINT "job_cards_card_only_if_ready" CHECK (("job_cards"."status" = 'lista') = ("job_cards"."card" is not null)),
	CONSTRAINT "job_cards_error_code" CHECK ("job_cards"."error_code" is null or char_length("job_cards"."error_code") <= 60)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_cards_jd_hash" ON "job_cards" USING btree ("jd_hash");