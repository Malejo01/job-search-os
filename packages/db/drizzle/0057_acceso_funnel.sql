CREATE TABLE "acceso_funnel" (
	"hour" timestamp with time zone NOT NULL,
	"origin" text NOT NULL,
	"step" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "acceso_funnel_hour_origin_step_role_pk" PRIMARY KEY("hour","origin","step","role"),
	CONSTRAINT "acceso_funnel_step_check" CHECK ("acceso_funnel"."step" in ('visita', 'empezado', 'carrera', 'enviado', 'tope')),
	CONSTRAINT "acceso_funnel_origin_check" CHECK ("acceso_funnel"."origin" ~ '^[a-z0-9-]{1,40}$'),
	CONSTRAINT "acceso_funnel_role_check" CHECK ("acceso_funnel"."role" ~ '^[a-z_]{0,40}$')
);
