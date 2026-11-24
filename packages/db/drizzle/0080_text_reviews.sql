CREATE TABLE "text_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"text_key" text NOT NULL,
	"default_hash" text NOT NULL,
	"status" text NOT NULL,
	"proposal" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "text_reviews_key" CHECK ("text_reviews"."text_key" ~ '^[A-Za-z0-9_.-]+$' and char_length("text_reviews"."text_key") <= 120),
	CONSTRAINT "text_reviews_hash" CHECK ("text_reviews"."default_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "text_reviews_status" CHECK ("text_reviews"."status" in ('aprobada', 'propuesta')),
	CONSTRAINT "text_reviews_proposal" CHECK ("text_reviews"."proposal" is null or char_length("text_reviews"."proposal") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "text_reviews" ADD CONSTRAINT "text_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "text_reviews_key_created" ON "text_reviews" USING btree ("text_key","created_at" DESC NULLS LAST);