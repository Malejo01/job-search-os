CREATE TABLE "cv_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cv_drafts_kind" CHECK ("cv_drafts"."kind" in ('chat', 'coach')),
	CONSTRAINT "cv_drafts_payload" CHECK (jsonb_typeof("cv_drafts"."payload") = 'object' and octet_length("cv_drafts"."payload"::text) <= 60000)
);
--> statement-breakpoint
ALTER TABLE "cv_drafts" ADD CONSTRAINT "cv_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cv_drafts_user_kind" ON "cv_drafts" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "cv_drafts_updated_at" ON "cv_drafts" USING btree ("updated_at");