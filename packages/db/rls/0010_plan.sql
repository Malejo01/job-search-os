-- Plan de la beta paga (C-11b): profiles.plan, profiles.plan_until y profiles.plan_source (C3-1, migración
-- 0051), más profiles.plan_notified_at (C4-1, migración 0055). Idempotente: corre en cada db:migrate.
--
-- profiles_owner (0000) deja que cada persona actualice su propia fila, y eso incluiría su plan. Este
-- trigger lo impide: la app (jobsearch_app, o cualquier rol que no sea el dueño de la tabla ni tenga
-- BYPASSRLS o superusuario) no puede cambiar el plan, su vencimiento, su origen ni la marca del aviso de
-- vencimiento (la escribe solo el cron, como dueño), ni crear un perfil
-- que no sea «gratis». El plan lo cambia Mauro desde el panel de admin (admin_plan_set, rls/0015, que
-- corre como dueño) o con un UPDATE puntual conectado como dueño (docs/OPERACION.md).
-- La función NO es SECURITY DEFINER: corre como quien escribe, así current_user es ese rol.
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
  ELSIF NEW.plan IS DISTINCT FROM OLD.plan
     OR NEW.plan_until IS DISTINCT FROM OLD.plan_until
     OR NEW.plan_source IS DISTINCT FROM OLD.plan_source
     OR NEW.plan_notified_at IS DISTINCT FROM OLD.plan_notified_at THEN
    RAISE EXCEPTION 'profiles_plan_guard: el plan lo asigna el dueño';
  END IF;
  RETURN NEW;
END
$fn$;
-- Sin REVOKE: una función de trigger no se puede llamar sola, y la app tiene que poder dispararla

DROP TRIGGER IF EXISTS profiles_plan_guard ON public.profiles;
CREATE TRIGGER profiles_plan_guard
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_plan_guard();
