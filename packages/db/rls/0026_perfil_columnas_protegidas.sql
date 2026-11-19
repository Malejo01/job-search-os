-- Columnas del perfil que la app no decide. Idempotente: se aplica en cada pnpm db:migrate.
-- Amplía el guard de 0010 en vez de usar privilegios por columna: `profiles` tiene muchas columnas que la
-- app sí edita, y la dirección de ingesta la rota la persona. Este archivo corre después de 0010, así que
-- esta es la versión que queda vigente de la función.
--   plan, plan_until, plan_source, plan_notified_at -> solo el dueño (0010)
--   max_target_roles, pool_daily_eval_limit         -> solo el dueño
--   inbound_address                                 -> la app solo puede poner una dirección aleatoria
CREATE OR REPLACE FUNCTION public.profiles_plan_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles r
        WHERE r.rolname = current_user AND (r.rolsuper OR r.rolbypassrls)
     )
     OR current_user::text = (
       SELECT pg_catalog.pg_get_userbyid(c.relowner)::text
         FROM pg_catalog.pg_class c
        WHERE c.oid = 'public.profiles'::regclass
     ) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.plan <> 'gratis' OR NEW.plan_until IS NOT NULL OR NEW.plan_source IS NOT NULL
       OR NEW.plan_notified_at IS NOT NULL THEN
      RAISE EXCEPTION 'profiles_plan_guard: el plan lo asigna el dueño';
    END IF;
    IF NEW.max_target_roles IS NOT NULL OR NEW.pool_daily_eval_limit IS NOT NULL THEN
      RAISE EXCEPTION 'profiles_plan_guard: los topes los asigna el dueño';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.plan IS DISTINCT FROM OLD.plan
     OR NEW.plan_until IS DISTINCT FROM OLD.plan_until
     OR NEW.plan_source IS DISTINCT FROM OLD.plan_source
     OR NEW.plan_notified_at IS DISTINCT FROM OLD.plan_notified_at THEN
    RAISE EXCEPTION 'profiles_plan_guard: el plan lo asigna el dueño';
  END IF;
  IF NEW.max_target_roles IS DISTINCT FROM OLD.max_target_roles
     OR NEW.pool_daily_eval_limit IS DISTINCT FROM OLD.pool_daily_eval_limit THEN
    RAISE EXCEPTION 'profiles_plan_guard: los topes los asigna el dueño';
  END IF;
  IF NEW.inbound_address IS DISTINCT FROM OLD.inbound_address
     AND NEW.inbound_address !~ '^u_[a-z2-7]{20}@[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' THEN
    RAISE EXCEPTION 'profiles_plan_guard: dirección de ingesta no válida';
  END IF;
  RETURN NEW;
END
$fn$;

-- Cola de evaluación: el aviso del payload tiene que ser de la persona. La lectura de `jobs` pasa por su
-- propia RLS, y un jobId mal formado hace fallar el cast: la fila no entra.
DROP POLICY IF EXISTS "job_queue_owner" ON "job_queue";
CREATE POLICY "job_queue_owner" ON "job_queue" FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND (
      payload ->> 'jobId' IS NULL
      OR EXISTS (
        SELECT 1 FROM public.jobs j
         WHERE j.id = (payload ->> 'jobId')::uuid AND j.user_id = auth.uid()
      )
    )
  );
