-- Migración custom. Permisos del rol de la app (jobsearch_app) explícitos e idempotentes, para que
-- se repliquen en Docker, Neon y cualquier entorno futuro:
-- 1) lo que ya existe: USAGE en public y auth, SELECT/INSERT/UPDATE/DELETE en tablas, USAGE/SELECT en secuencias;
-- 2) lo que se cree después hereda: ALTER DEFAULT PRIVILEGES FOR ROLE <dueño que migra>. Se usa
--    current_user porque el dueño es jobsearch_owner en Neon y postgres en Docker/CI; los objetos
--    nuevos los crea siempre el rol que corre las migraciones.
GRANT USAGE ON SCHEMA public TO jobsearch_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA auth TO jobsearch_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO jobsearch_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO jobsearch_app;
--> statement-breakpoint
DO $$ BEGIN
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO jobsearch_app', current_user);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO jobsearch_app', current_user);
END $$;
