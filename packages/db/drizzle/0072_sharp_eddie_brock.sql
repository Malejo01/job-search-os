ALTER TABLE "profiles" ADD COLUMN "previous_inbound_address" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "previous_inbound_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_previous_inbound_address_unique" UNIQUE("previous_inbound_address");