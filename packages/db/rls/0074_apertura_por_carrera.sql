-- Apertura por carrera y baja del email de novedades (R32-03 y R32-09). Idempotente: corre en cada db:migrate.
--
-- Mismo patrón que 0054 y 0064: funciones SECURITY DEFINER con search_path fijo, objetos calificados, REVOKE de
-- PUBLIC, EXECUTE solo para authenticated y, donde cambia algo, la barrera `app_admins` adentro.
--
--   1. `open_careers` (la lista de carreras abiertas) y `career_opening_events` (quién la cambió y cuándo): no
--      llevan user_id (no son datos de una persona; `opened_by` y `admin_id` son quién operó y pasan a null si esa
--      cuenta se borra). Sin policies para la app: solo las toca el dueño, que es quien corre las funciones.
--   2. careers_open_list(): la lista de carreras abiertas. Sin sesión y sin barrera a propósito: la lee la lista
--      de espera pública para decir «todavía estamos sumando ofertas de …». Devuelve solo claves de carrera.
--   3. admin_career_set / admin_careers_open / admin_career_history: solo admins. Cada cambio real (abrir lo que
--      estaba cerrado, cerrar lo que estaba abierto) queda en el historial; repetir un cambio no escribe nada.
--   4. news_email_unsubscribe(uuid): baja del email de novedades sin sesión (R32-09). La app verifica antes la
--      firma del enlace (HMAC) y solo entonces llama a esta función; sin esa firma no hay forma de pedirla desde la
--      web. Solo pone `news_email` en false de esa persona: no lee ni devuelve nada más.

ALTER TABLE "open_careers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "open_careers" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "open_careers_definer_select" ON "open_careers";
CREATE POLICY "open_careers_definer_select" ON "open_careers" FOR SELECT TO CURRENT_USER
  USING (true);
DROP POLICY IF EXISTS "open_careers_definer_insert" ON "open_careers";
CREATE POLICY "open_careers_definer_insert" ON "open_careers" FOR INSERT TO CURRENT_USER
  WITH CHECK (true);
DROP POLICY IF EXISTS "open_careers_definer_delete" ON "open_careers";
CREATE POLICY "open_careers_definer_delete" ON "open_careers" FOR DELETE TO CURRENT_USER
  USING (true);
REVOKE ALL ON "open_careers" FROM authenticated;

ALTER TABLE "career_opening_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "career_opening_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "career_opening_events_definer_select" ON "career_opening_events";
CREATE POLICY "career_opening_events_definer_select" ON "career_opening_events" FOR SELECT TO CURRENT_USER
  USING (true);
DROP POLICY IF EXISTS "career_opening_events_definer_insert" ON "career_opening_events";
CREATE POLICY "career_opening_events_definer_insert" ON "career_opening_events" FOR INSERT TO CURRENT_USER
  WITH CHECK (true);
REVOKE ALL ON "career_opening_events" FROM authenticated;

-- ─── La lista, para quien sea (la lista de espera pública la usa sin sesión) ───────────────────────────────
DROP FUNCTION IF EXISTS public.careers_open_list();
CREATE FUNCTION public.careers_open_list()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT coalesce(array_agg(c.career ORDER BY c.career), '{}'::text[]) FROM public.open_careers c
$fn$;
REVOKE ALL ON FUNCTION public.careers_open_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.careers_open_list() TO authenticated;

-- ─── Cambiar la lista (solo admins) ────────────────────────────────────────────────────────────────────
-- Devuelve 'ok' si cambió algo, 'sin_cambio' si ya estaba así y 'invalida' si la clave no tiene la forma de una
-- carrera. Que la clave exista en el catálogo lo valida el código (la base no conoce ROLE_KEYS). Con la fila
-- bloqueada: dos clics a la vez no escriben dos veces el mismo cambio.
DROP FUNCTION IF EXISTS public.admin_career_set(text, boolean);
CREATE FUNCTION public.admin_career_set(p_career text, p_open boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_career text := btrim(coalesce(p_career, ''));
  v_changed integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_career_set: no autorizado';
  END IF;
  -- «otra» no es una carrera del catálogo: nunca abre (ni se puede cerrar lo que nunca estuvo)
  IF v_career !~ '^[a-z_]{1,40}$' OR v_career = 'otra' OR p_open IS NULL THEN
    RETURN 'invalida';
  END IF;
  -- Serializa los cambios de una misma carrera
  PERFORM pg_advisory_xact_lock(hashtext('open_careers:' || v_career));
  IF p_open THEN
    INSERT INTO public.open_careers (career, opened_by) VALUES (v_career, auth.uid())
    ON CONFLICT (career) DO NOTHING;
  ELSE
    DELETE FROM public.open_careers WHERE career = v_career;
  END IF;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed = 0 THEN
    RETURN 'sin_cambio';
  END IF;
  INSERT INTO public.career_opening_events (career, action, admin_id)
  VALUES (v_career, CASE WHEN p_open THEN 'abrir' ELSE 'cerrar' END, auth.uid());
  RETURN 'ok';
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_career_set(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_career_set(text, boolean) TO authenticated;

-- ─── Qué está abierto, desde cuándo y quién lo abrió (solo admins) ─────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_careers_open();
CREATE FUNCTION public.admin_careers_open()
RETURNS TABLE (career text, opened_at timestamptz, opened_by_email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_careers_open: no autorizado';
  END IF;
  RETURN QUERY
    SELECT c.career, c.opened_at, u.email
      FROM public.open_careers c
      LEFT JOIN public.users u ON u.id = c.opened_by
     ORDER BY c.career;
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_careers_open() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_careers_open() TO authenticated;

-- ─── Historial de cambios, los más nuevos primero (solo admins). Tope de 100 ────────────────────────────
DROP FUNCTION IF EXISTS public.admin_career_history(integer);
CREATE FUNCTION public.admin_career_history(p_limit integer DEFAULT 30)
RETURNS TABLE (career text, action text, admin_email text, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_career_history: no autorizado';
  END IF;
  RETURN QUERY
    SELECT e.career, e.action, u.email, e.created_at
      FROM public.career_opening_events e
      LEFT JOIN public.users u ON u.id = e.admin_id
     ORDER BY e.created_at DESC, e.id
     LIMIT least(greatest(coalesce(p_limit, 30), 1), 100);
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_career_history(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_career_history(integer) TO authenticated;

-- ─── Baja del email de novedades sin sesión (R32-09) ───────────────────────────────────────────────────
-- Devuelve siempre true, exista o no la cuenta: no es un oráculo de existencia y el enlace de baja es idempotente.
-- La firma (HMAC con vencimiento) la verifica la app antes de llamar; acá no hay barrera de admin porque quien baja
-- no tiene sesión.
DROP FUNCTION IF EXISTS public.news_email_unsubscribe(uuid);
CREATE FUNCTION public.news_email_unsubscribe(p_user uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  UPDATE public.profiles SET news_email = false WHERE user_id = p_user;
  RETURN true;
END
$fn$;
-- Sin EXECUTE para la app: la función no tiene barrera (actúa sobre el uuid que le pasan), así que solo la llama la
-- ruta pública de baja con la conexión de servicio, DESPUÉS de verificar la firma del enlace. Si no, cualquier sesión
-- podría dar de baja a otra persona. El REVOKE explícito a `authenticated` limpia el permiso en bases donde una
-- versión anterior de este archivo ya lo había dado.
REVOKE ALL ON FUNCTION public.news_email_unsubscribe(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.news_email_unsubscribe(uuid) FROM authenticated;

-- ─── Columnas de `profiles` que la persona no escribe directo (R32-01 y R32-09) ────────────────────────
-- `career_asked_at` (cuándo se le pidió la carrera) y `news_email_sent_at` (último email de novedades) los decide
-- el servidor: la persona sí cambia `career_other` y `news_email`. Mismo criterio que profiles_plan_guard (0026):
-- el dueño de la tabla y los roles con bypass pasan; el rol de la app, no.
CREATE OR REPLACE FUNCTION public.profiles_news_guard()
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
    IF NEW.career_asked_at IS NOT NULL OR NEW.news_email_sent_at IS NOT NULL THEN
      RAISE EXCEPTION 'profiles_news_guard: esas columnas las escribe el servidor';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.career_asked_at IS DISTINCT FROM OLD.career_asked_at
     OR NEW.news_email_sent_at IS DISTINCT FROM OLD.news_email_sent_at THEN
    RAISE EXCEPTION 'profiles_news_guard: esas columnas las escribe el servidor';
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS profiles_news_guard ON public.profiles;
CREATE TRIGGER profiles_news_guard BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_news_guard();

-- ─── Recuadro «¿Cuál es tu carrera?» (R32-01) ──────────────────────────────────────────────────────────
-- Como la persona no escribe `career_asked_at`, el guardado y el «Ahora no» pasan por estas dos funciones, que solo
-- tocan la fila de auth.uid(). career_prompt_save escribe únicamente si la carrera sigue siendo la que la app leyó
-- (`p_expected`): si la cargó en otra pestaña mientras tanto, no pisa nada y devuelve false.
DROP FUNCTION IF EXISTS public.career_prompt_save(text[], text, text[]);
CREATE FUNCTION public.career_prompt_save(p_roles text[], p_other text, p_expected text[])
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_rows integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.profiles
     SET target_roles = coalesce(p_roles, '{}'::text[]),
         target_role = (coalesce(p_roles, '{}'::text[]))[1],
         career_other = p_other,
         career_asked_at = now(),
         updated_at = now()
   WHERE user_id = auth.uid()
     AND career_other IS NULL
     AND target_roles = coalesce(p_expected, '{}'::text[]);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END
$fn$;
REVOKE ALL ON FUNCTION public.career_prompt_save(text[], text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.career_prompt_save(text[], text, text[]) TO authenticated;

DROP FUNCTION IF EXISTS public.career_prompt_dismiss();
CREATE FUNCTION public.career_prompt_dismiss()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_rows integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.profiles SET career_asked_at = now()
   WHERE user_id = auth.uid() AND career_asked_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END
$fn$;
REVOKE ALL ON FUNCTION public.career_prompt_dismiss() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.career_prompt_dismiss() TO authenticated;
