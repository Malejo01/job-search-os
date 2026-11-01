ALTER TABLE "inbound_emails" ADD COLUMN "email_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_emails_email_id" ON "inbound_emails" USING btree ("email_id");