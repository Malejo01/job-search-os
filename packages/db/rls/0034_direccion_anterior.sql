-- Dirección anterior de una rotación (S3-26). Idempotente: se aplica en cada pnpm db:migrate.
-- La rotación la hace el administrador (conexión del dueño) y deja la dirección vieja como alias por unos
-- días. La app no escribe esas dos columnas: si pudiera, una persona se asignaría como alias la dirección
-- vieja de otra y recibiría su correo. Es la misma función de 0026 con esa regla de más; este archivo corre
-- después, así que esta es la versión que queda vigente.
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
    IF NEW.previous_inbound_address IS NOT NULL OR NEW.previous_inbound_until IS NOT NULL THEN
      RAISE EXCEPTION 'profiles_plan_guard: la dirección anterior la asigna el dueño';
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
  IF NEW.previous_inbound_address IS DISTINCT FROM OLD.previous_inbound_address
     OR NEW.previous_inbound_until IS DISTINCT FROM OLD.previous_inbound_until THEN
    RAISE EXCEPTION 'profiles_plan_guard: la dirección anterior la asigna el dueño';
  END IF;
  IF NEW.inbound_address IS DISTINCT FROM OLD.inbound_address
     AND NEW.inbound_address !~ '^u_[a-z2-7]{20}@[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' THEN
    RAISE EXCEPTION 'profiles_plan_guard: dirección de ingesta no válida';
  END IF;
  RETURN NEW;
END
$fn$;
