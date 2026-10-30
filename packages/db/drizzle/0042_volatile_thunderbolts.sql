CREATE INDEX "applications_job" ON "applications" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "evaluations_job_created" ON "evaluations" USING btree ("job_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "evaluations_user_created" ON "evaluations" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "inbound_emails_user_received" ON "inbound_emails" USING btree ("user_id","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "jobs_user_first_seen" ON "jobs" USING btree ("user_id","first_seen_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "learning_plan_items_user_priority" ON "learning_plan_items" USING btree ("user_id","priority" DESC NULLS LAST);