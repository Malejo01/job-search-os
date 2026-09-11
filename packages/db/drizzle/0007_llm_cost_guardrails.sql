ALTER TABLE "llm_calls" ADD COLUMN "tokens_reasoning" integer;--> statement-breakpoint
ALTER TABLE "model_routing" ADD COLUMN "fallback_input_usd_per_mtok" real;--> statement-breakpoint
ALTER TABLE "model_routing" ADD COLUMN "fallback_output_usd_per_mtok" real;