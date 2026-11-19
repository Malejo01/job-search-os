-- Una tabla nueva nace sin permisos para la app. Idempotente: se aplica en cada pnpm db:migrate.
-- Los permisos los da 0000 (`GRANT ... ON ALL TABLES`), en la misma transacción que aplica las policies
-- (`applyRlsFiles`), así la app nunca ve una tabla con permisos y sin RLS. Ver ADR-042.
DO $$
BEGIN
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM authenticated', current_user);
END
$$;
