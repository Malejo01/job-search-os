CREATE TABLE "career_opening_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"career" text NOT NULL,
	"action" text NOT NULL,
	"admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "career_opening_events_action" CHECK ("career_opening_events"."action" in ('abrir', 'cerrar')),
	CONSTRAINT "career_opening_events_career_shape" CHECK ("career_opening_events"."career" ~ '^[a-z_]{1,40}$')
);
--> statement-breakpoint
CREATE TABLE "open_careers" (
	"career" text PRIMARY KEY NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_by" uuid,
	CONSTRAINT "open_careers_career_shape" CHECK ("open_careers"."career" ~ '^[a-z_]{1,40}$')
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "career_other" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "career_asked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "news_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "news_email_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "career_opening_events" ADD CONSTRAINT "career_opening_events_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_careers" ADD CONSTRAINT "open_careers_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "career_opening_events_created" ON "career_opening_events" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_career_other_shape" CHECK ("profiles"."career_other" is null or char_length("profiles"."career_other") between 2 and 60);