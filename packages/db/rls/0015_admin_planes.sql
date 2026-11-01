-- Administración de planes desde el panel de admin (C3-1). Idempotente: corre en cada db:migrate.
--
-- Hasta ahora Mauro cambiaba el plan con un UPDATE conectado como dueño (docs/OPERACION.md). Con la beta
-- paga hay que activar planes a mano todos los meses, así que el panel (/settings/planes) lo hace por
-- estas funciones. La app sigue sin poder tocar el plan: el trigger profiles_plan_guard (0010) frena al
-- rol jobsearch_app y deja pasar al dueño, y estas funciones son SECURITY DEFINER, o sea que corren
-- como el dueño de la tabla. Mismo patrón que waitlist_admin_* (0006): search_path fijo, objetos
-- calificados, REVOKE de PUBLIC y EXECUTE solo para authenticated, y la barrera de la base es app_admins
-- (la app además verifica ADMIN_EMAILS antes de llamarlas, lib/plan-admin.ts).
--
-- Qué NO hacen: no crean personas ni perfiles (la persona tiene que haberse registrado y terminado el
-- onboarding), no tocan los topes propios del perfil (max_target_roles, pool_daily_eval_limit) y no
-- asignan los planes viejos (fundador, pase_3_meses): esos siguen siendo un UPDATE a mano. La fecha de
-- fin la calcula el código (packages/pipeline/src/plan-access.ts) y llega acá ya resuelta; la base solo
-- la acota. Vencer no borra nada: un plan vencido rige como «gratis» (effectivePlan) y los datos quedan.

-- Con FORCE RLS el dueño de las funciones queda sujeto a las policies si su rol no tiene BYPASSRLS
-- (Neon). Mismo criterio que profiles_definer_select (0009): TO CURRENT_USER es el rol que aplica la
-- migración, dueño de las tablas y las funciones; el rol de la app no queda alcanzado.
-- Ojo para funciones futuras: cualquier SECURITY DEFINER del dueño puede actualizar cualquier perfil.
DROP POLICY IF EXISTS "profiles_definer_update" ON "profiles";
CREATE POLICY "profiles_definer_update" ON "profiles" FOR UPDATE TO CURRENT_USER
  USING (true) WITH CHECK (true);

-- Una persona por email: su plan hoy. Sin fila = no existe o no terminó el onboarding.
DROP FUNCTION IF EXISTS public.admin_plan_get(text);
CREATE FUNCTION public.admin_plan_get(p_email text)
RETURNS TABLE (
  plan text,
  plan_source text,
  plan_until timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_plan: no autorizado';
  END IF;
  RETURN QUERY
    SELECT p.plan, p.plan_source, p.plan_until
      FROM public.users u
      JOIN public.profiles p ON p.user_id = u.id
     WHERE u.email = lower(btrim(p_email))
     LIMIT 1;
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_plan_get(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_plan_get(text) TO authenticated;

-- Quién tiene (o tuvo) un plan pago: lo que el panel muestra. Los que nunca tuvieron plan no salen.
-- Con vencimiento primero (los que vencen antes, arriba); tope de 200.
DROP FUNCTION IF EXISTS public.admin_plan_list(integer);
CREATE FUNCTION public.admin_plan_list(p_limit integer DEFAULT 200)
RETURNS TABLE (
  email text,
  plan text,
  plan_source text,
  plan_until timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_plan: no autorizado';
  END IF;
  RETURN QUERY
    SELECT u.email, p.plan, p.plan_source, p.plan_until
      FROM public.profiles p
      JOIN public.users u ON u.id = p.user_id
     WHERE p.plan <> 'gratis'
     ORDER BY p.plan_until ASC NULLS LAST, u.email
     LIMIT least(greatest(coalesce(p_limit, 200), 1), 200);
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_plan_list(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_plan_list(integer) TO authenticated;

-- Activa o quita el plan de la beta de una persona. Devuelve la fila resultante, o ninguna si la
-- persona no existe o no terminó el onboarding (el código distingue ese caso y lo explica).
--   p_plan 'lista'  → p_source 'pago' | 'beca' y p_until entre ahora y 400 días (defensa en profundidad
--                     contra un error de tipeo; el código manda ~30 días).
--   p_plan 'gratis' → quita el plan: source y until quedan en null.
-- Cualquier otro plan se rechaza: los planes viejos se asignan a mano, como hasta ahora.
DROP FUNCTION IF EXISTS public.admin_plan_set(text, text, text, timestamptz);
CREATE FUNCTION public.admin_plan_set(
  p_email text,
  p_plan text,
  p_source text,
  p_until timestamptz
)
RETURNS TABLE (
  plan text,
  plan_source text,
  plan_until timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
#variable_conflict use_column
DECLARE
  v_user uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_plan: no autorizado';
  END IF;
  IF p_plan = 'lista' THEN
    IF p_source IS NULL OR p_source NOT IN ('pago', 'beca') THEN
      RAISE EXCEPTION 'admin_plan: el origen tiene que ser pago o beca';
    END IF;
    IF p_until IS NULL OR p_until <= now() OR p_until > now() + interval '400 days' THEN
      RAISE EXCEPTION 'admin_plan: la fecha de fin tiene que estar entre ahora y 400 días';
    END IF;
  ELSIF p_plan = 'gratis' THEN
    IF p_source IS NOT NULL OR p_until IS NOT NULL THEN
      RAISE EXCEPTION 'admin_plan: el plan gratis no lleva origen ni fecha';
    END IF;
  ELSE
    RAISE EXCEPTION 'admin_plan: plan no permitido';
  END IF;

  SELECT u.id INTO v_user FROM public.users u WHERE u.email = lower(btrim(p_email));
  IF v_user IS NULL THEN
    RETURN;
  END IF;

  -- RETURN QUERY no acepta un UPDATE solo: va dentro de un WITH
  RETURN QUERY
    WITH changed AS (
      UPDATE public.profiles p
         SET plan = p_plan, plan_source = p_source, plan_until = p_until, updated_at = now()
       WHERE p.user_id = v_user
      RETURNING p.plan, p.plan_source, p.plan_until
    )
    SELECT c.plan, c.plan_source, c.plan_until FROM changed c;
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_plan_set(text, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_plan_set(text, text, text, timestamptz) TO authenticated;
