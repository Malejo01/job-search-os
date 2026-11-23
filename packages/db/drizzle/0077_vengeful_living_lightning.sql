CREATE TABLE "plan_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"admin_id" uuid,
	"action" text NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_events_action" CHECK ("plan_events"."action" in ('activar', 'renovar', 'quitar', 'rechazar_aviso', 'marca')),
	CONSTRAINT "plan_events_source" CHECK ("plan_events"."source" is null or "plan_events"."source" in ('pago', 'beca'))
);
--> statement-breakpoint
ALTER TABLE "plan_events" ADD CONSTRAINT "plan_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_events" ADD CONSTRAINT "plan_events_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_events_created" ON "plan_events" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "plan_events_user" ON "plan_events" USING btree ("user_id");