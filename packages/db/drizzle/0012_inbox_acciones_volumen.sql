CREATE TABLE "inbound_rejections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"rejected" integer DEFAULT 0 NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD COLUMN "seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD COLUMN "dismissed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_rejections_user_window" ON "inbound_rejections" USING btree ("user_id","window_start");