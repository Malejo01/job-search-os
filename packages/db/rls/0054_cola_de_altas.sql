-- Cola de altas e historial del plan (R22-02). Idempotente: corre en cada db:migrate.
--
-- Dos cosas, las dos solo para admins (app_admins), por funciones SECURITY DEFINER con el mismo patrón que
-- 0015 y 0022: search_path fijo, objetos calificados, REVOKE de PUBLIC y EXECUTE solo para authenticated.
--   1. La cola de avisos «Ya pagué» (`payment_notices`, 0053): listar los pendientes, activar (da el plan y
--      marca el aviso en la misma transacción, con el aviso bloqueado: un doble clic no activa dos veces) y
--      rechazar con un motivo corto.
--   2. El historial de cambios del plan (`plan_events`): quién cambió el plan de quién, cuándo y cómo. Sin
--      emails ni montos. Una cuenta común no lo lee: la tabla no tiene policy para el rol de la app.
ALTER TABLE "plan_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plan_events" FORCE ROW LEVEL SECURITY;

-- Solo el dueño de la tabla (las funciones de abajo y el cron) queda alcanzado por estas policies; el rol de
-- la app no tiene ninguna, así que no lee ni escribe `plan_events` directamente.
DROP POLICY IF EXISTS "plan_events_definer_select" ON "plan_events";
CREATE POLICY "plan_events_definer_select" ON "plan_events" FOR SELECT TO CURRENT_USER
  USING (true);
DROP POLICY IF EXISTS "plan_events_definer_insert" ON "plan_events";
CREATE POLICY "plan_events_definer_insert" ON "plan_events" FOR INSERT TO CURRENT_USER
  WITH CHECK (true);
REVOKE ALL ON "plan_events" FROM authenticated;

-- Anota un cambio de plan de la persona con ese email. Si no existe, no hace nada.
DROP FUNCTION IF EXISTS public.admin_plan_event_add(text, text, text);
CREATE FUNCTION public.admin_plan_event_add(p_email text, p_action text, p_source text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_user uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_plan_events: no autorizado';
  END IF;
  SELECT u.id INTO v_user FROM public.users u WHERE u.email = lower(btrim(p_email));
  IF v_user IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.plan_events (user_id, admin_id, action, source)
  VALUES (v_user, auth.uid(), p_action, p_source);
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_plan_event_add(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_plan_event_add(text, text, text) TO authenticated;

-- Últimos cambios, los más nuevos primero. Tope de 50.
DROP FUNCTION IF EXISTS public.admin_plan_event_list(integer);
CREATE FUNCTION public.admin_plan_event_list(p_limit integer DEFAULT 20)
RETURNS TABLE (email text, action text, source text, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_plan_events: no autorizado';
  END IF;
  RETURN QUERY
    SELECT u.email, e.action, e.source, e.created_at
      FROM public.plan_events e
      JOIN public.users u ON u.id = e.user_id
     ORDER BY e.created_at DESC, e.id
     LIMIT least(greatest(coalesce(p_limit, 20), 1), 50);
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_plan_event_list(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_plan_event_list(integer) TO authenticated;

-- Avisos pendientes, los más viejos primero. Tope de 100.
DROP FUNCTION IF EXISTS public.admin_payment_notice_list(integer);
CREATE FUNCTION public.admin_payment_notice_list(p_limit integer DEFAULT 100)
RETURNS TABLE (id uuid, email text, plan text, operation_number text, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_payment_notice: no autorizado';
  END IF;
  RETURN QUERY
    SELECT n.id, u.email, n.plan, n.operation_number, n.created_at
      FROM public.payment_notices n
      JOIN public.users u ON u.id = n.user_id
     WHERE n.status = 'pendiente'
     ORDER BY n.created_at ASC, n.id
     LIMIT least(greatest(coalesce(p_limit, 100), 1), 100);
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_payment_notice_list(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_payment_notice_list(integer) TO authenticated;

-- Activa el plan de un aviso pendiente como pago hasta `p_until` (lo calcula el pipeline; la base solo lo
-- acota, igual que admin_plan_set) y lo marca activado. Con el aviso bloqueado: si ya estaba resuelto
-- devuelve 'ya_resuelto' y no toca nada, así activar dos veces no suma días dos veces.
-- Devuelve: 'ok', 'no_existe' (el aviso no existe o la persona no terminó el onboarding),
-- 'ya_resuelto' o 'plan_viejo' (tiene un plan viejo: se cambia a mano).
DROP FUNCTION IF EXISTS public.admin_payment_notice_activate(uuid, timestamptz);
CREATE FUNCTION public.admin_payment_notice_activate(p_id uuid, p_until timestamptz)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_notice public.payment_notices%ROWTYPE;
  v_plan text;
  v_saved integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_payment_notice: no autorizado';
  END IF;
  SELECT * INTO v_notice FROM public.payment_notices n WHERE n.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'no_existe';
  END IF;
  IF v_notice.status <> 'pendiente' THEN
    RETURN 'ya_resuelto';
  END IF;
  SELECT p.plan INTO v_plan FROM public.profiles p WHERE p.user_id = v_notice.user_id;
  IF v_plan IS NULL THEN
    RETURN 'no_existe';
  END IF;
  IF v_plan <> 'gratis' AND v_plan <> v_notice.plan THEN
    RETURN 'plan_viejo';
  END IF;
  SELECT count(*) INTO v_saved
    FROM public.admin_plan_set(
      (SELECT u.email FROM public.users u WHERE u.id = v_notice.user_id),
      v_notice.plan, 'pago', p_until);
  IF v_saved = 0 THEN
    RETURN 'no_existe';
  END IF;
  UPDATE public.payment_notices SET status = 'activado', resolved_at = now() WHERE id = p_id;
  INSERT INTO public.plan_events (user_id, admin_id, action, source)
  VALUES (v_notice.user_id, auth.uid(), 'activar', 'pago');
  RETURN 'ok';
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_payment_notice_activate(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_payment_notice_activate(uuid, timestamptz) TO authenticated;

-- Rechaza un aviso pendiente con un motivo corto (1 a 200 caracteres). 'ok', 'no_existe', 'ya_resuelto' o
-- 'motivo_invalido'. Con el aviso bloqueado, rechazar dos veces no cambia el primer motivo.
DROP FUNCTION IF EXISTS public.admin_payment_notice_reject(uuid, text);
CREATE FUNCTION public.admin_payment_notice_reject(p_id uuid, p_reason text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_notice public.payment_notices%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_payment_notice: no autorizado';
  END IF;
  IF char_length(v_reason) NOT BETWEEN 1 AND 200 THEN
    RETURN 'motivo_invalido';
  END IF;
  SELECT * INTO v_notice FROM public.payment_notices n WHERE n.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'no_existe';
  END IF;
  IF v_notice.status <> 'pendiente' THEN
    RETURN 'ya_resuelto';
  END IF;
  UPDATE public.payment_notices
     SET status = 'rechazado', reject_reason = v_reason, resolved_at = now()
   WHERE id = p_id;
  INSERT INTO public.plan_events (user_id, admin_id, action, source)
  VALUES (v_notice.user_id, auth.uid(), 'rechazar_aviso', NULL);
  RETURN 'ok';
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_payment_notice_reject(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_payment_notice_reject(uuid, text) TO authenticated;
