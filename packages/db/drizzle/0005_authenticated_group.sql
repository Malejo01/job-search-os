-- Migración custom. authenticated pasa a ser el rol de agrupación de la app (decisión de Mauro,
-- 2026-09-10): los GRANTs van al grupo y los roles de login (hoy jobsearch_app; mañana anon,
-- service...) son miembros. Las policies siguen sin cláusula TO: aplican a todos y solo se
-- saltean con BYPASSRLS, por eso son portables entre Docker, Neon y Supabase.
GRANT USAGE ON SCHEMA public TO authenticated;
--> statement-breakpoint
GRANT USAGE ON SCHEMA auth TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
--> statement-breakpoint
DO $$ BEGIN
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated', current_user);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated', current_user);
  -- Los directos a jobsearch_app dejan de ser necesarios: hereda del grupo
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM jobsearch_app', current_user);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM jobsearch_app', current_user);
END $$;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM jobsearch_app;
--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM jobsearch_app;
--> statement-breakpoint
GRANT authenticated TO jobsearch_app;
