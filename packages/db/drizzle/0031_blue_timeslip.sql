CREATE TABLE "user_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"level" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_skills_level_range" CHECK ("user_skills"."level" between 0 and 3),
	CONSTRAINT "user_skills_name_length" CHECK (char_length("user_skills"."name") between 2 and 40)
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "accepted_modalities" text[] DEFAULT '{remoto}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "job_languages" text[] DEFAULT '{es,en}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_skills_user_name" ON "user_skills" USING btree ("user_id",lower("name"));