CREATE TABLE "academy_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"content_hash" text NOT NULL,
	"status" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academy_reviews_slug" CHECK ("academy_reviews"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("academy_reviews"."slug") <= 80),
	CONSTRAINT "academy_reviews_hash" CHECK ("academy_reviews"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "academy_reviews_status" CHECK ("academy_reviews"."status" in ('aprobada', 'cambios')),
	CONSTRAINT "academy_reviews_comment" CHECK ("academy_reviews"."comment" is null or char_length("academy_reviews"."comment") <= 500)
);
--> statement-breakpoint
ALTER TABLE "academy_reviews" ADD CONSTRAINT "academy_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "academy_reviews_slug_created" ON "academy_reviews" USING btree ("slug","created_at" DESC NULLS LAST);