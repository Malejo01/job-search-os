CREATE TABLE "cv_offer_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"proposal" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cv_offer_versions_proposal" CHECK (jsonb_typeof("cv_offer_versions"."proposal") = 'object' and octet_length("cv_offer_versions"."proposal"::text) <= 60000)
);
--> statement-breakpoint
ALTER TABLE "cv_offer_versions" ADD CONSTRAINT "cv_offer_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cv_offer_versions" ADD CONSTRAINT "cv_offer_versions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cv_offer_versions_user_job" ON "cv_offer_versions" USING btree ("user_id","job_id");--> statement-breakpoint
CREATE INDEX "cv_offer_versions_job" ON "cv_offer_versions" USING btree ("job_id");