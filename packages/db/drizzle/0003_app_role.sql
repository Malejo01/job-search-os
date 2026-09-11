-- Migración custom (drizzle-kit generate --custom). Rol de aplicación separado del dueño:
-- el dueño de una tabla ignora RLS salvo FORCE, y jobsearch_owner además tiene BYPASSRLS en
-- Neon. La app se conecta como jobsearch_app (sin ownership ni BYPASSRLS) y las migraciones
-- siguen con el dueño. FORCE ROW LEVEL SECURITY va en rls/0000_policies.sql (idempotente).
-- La contraseña NO va acá: en Docker la fija pnpm db:migrate --local; en Neon la carga Mauro.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jobsearch_app') THEN
    CREATE ROLE jobsearch_app LOGIN NOBYPASSRLS NOCREATEDB NOCREATEROLE NOSUPERUSER;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO jobsearch_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA auth TO jobsearch_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO jobsearch_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO jobsearch_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO jobsearch_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO jobsearch_app;
