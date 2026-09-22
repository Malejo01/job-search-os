CREATE TABLE "inbound_sender_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"verdict" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_sender_domains_user_domain" ON "inbound_sender_domains" USING btree ("user_id","domain");