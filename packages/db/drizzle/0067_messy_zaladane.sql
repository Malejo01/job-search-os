CREATE TABLE "plan_overrides" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"override" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_overrides_override" CHECK ("plan_overrides"."override" in ('becado', 'tester_50'))
);
--> statement-breakpoint
ALTER TABLE "plan_overrides" ADD CONSTRAINT "plan_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;