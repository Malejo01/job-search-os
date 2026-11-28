DROP INDEX "cv_offer_versions_user_job";--> statement-breakpoint
CREATE INDEX "cv_offer_versions_user_job_created" ON "cv_offer_versions" USING btree ("user_id","job_id","created_at");