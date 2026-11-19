CREATE INDEX "llm_calls_task_created" ON "llm_calls" USING btree ("task","created_at");--> statement-breakpoint
CREATE INDEX "llm_calls_created" ON "llm_calls" USING btree ("created_at");