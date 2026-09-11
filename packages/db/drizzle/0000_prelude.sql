-- Migración custom (drizzle-kit generate --custom). Prerrequisitos del schema:
-- 1) pgvector para embeddings (fase 2). 2) Rol `authenticated` y función `auth.uid()`
--    solo si no existen: en Supabase ya vienen; en Docker/CI/Neon se crea un stub que lee
--    `app.user_id` (SET LOCAL app.user_id = '<uuid>') para que las policies RLS sean portables.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS auth;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND p.proname = 'uid'
  ) THEN
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$
      SELECT nullif(current_setting('app.user_id', true), '')::uuid
    $fn$;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA auth TO authenticated;
