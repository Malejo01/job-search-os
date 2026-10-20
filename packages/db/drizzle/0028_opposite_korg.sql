ALTER TABLE "waitlist" ADD COLUMN "invited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "invitation_id" uuid;