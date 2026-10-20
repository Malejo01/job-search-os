CREATE TABLE "waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"heard_from" text,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_role_check" CHECK ("waitlist"."role" in ('frontend', 'backend', 'fullstack', 'qa', 'data_analyst', 'soporte_it', 'ai_engineer', 'ux_ui', 'marketing_digital', 'producto_proyectos', 'rrhh_it', 'customer_success', 'ciberseguridad'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_email_unique" ON "waitlist" USING btree ("email");--> statement-breakpoint
CREATE INDEX "waitlist_ip_hash_created" ON "waitlist" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "waitlist_created" ON "waitlist" USING btree ("created_at");