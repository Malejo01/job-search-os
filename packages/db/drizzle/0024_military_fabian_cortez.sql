ALTER TYPE "public"."source_kind" ADD VALUE 'wwr';--> statement-breakpoint
ALTER TYPE "public"."source_kind" ADD VALUE 'greenhouse';--> statement-breakpoint
ALTER TYPE "public"."source_kind" ADD VALUE 'lever';--> statement-breakpoint
ALTER TYPE "public"."source_kind" ADD VALUE 'ashby';--> statement-breakpoint
CREATE TABLE "ats_boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"token" text NOT NULL,
	"region" text,
	"company_name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"notes" text,
	"last_fetch_at" timestamp with time zone,
	"last_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ats_boards_provider_check" CHECK ("ats_boards"."provider" in ('greenhouse', 'lever', 'ashby'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ats_boards_provider_token" ON "ats_boards" USING btree ("provider","token");