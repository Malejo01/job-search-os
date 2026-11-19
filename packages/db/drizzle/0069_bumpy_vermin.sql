CREATE TABLE "login_attempts" (
	"email_hash" text PRIMARY KEY NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_attempts_hash_shape" CHECK ("login_attempts"."email_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX "login_attempts_last_attempt" ON "login_attempts" USING btree ("last_attempt_at");