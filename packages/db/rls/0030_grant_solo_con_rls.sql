-- Los permisos de la app solo valen para tablas con RLS activo. Idempotente: corre en cada db:migrate.
--
-- 0000 da SELECT/INSERT/UPDATE/DELETE sobre TODAS las tablas de public al grupo authenticated (del que hereda
-- jobsearch_app) para cubrir las tablas nuevas. Sin este paso, una tabla creada sin RLS quedaba accesible para la
-- app al terminar ese mismo paso, y solo la frenaba el test de cobertura. Acá se retiran los permisos de toda
-- tabla de public sin RLS. Corre en la misma transacción que 0000 (applyRlsFiles), así la app nunca ve el
-- intervalo en que la tabla tuvo permisos.
-- Las tablas con RLS activo conservan los de 0000. Las vistas y las secuencias no se tocan.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t.relname);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM jobsearch_app', t.relname);
  END LOOP;
END
$$;
