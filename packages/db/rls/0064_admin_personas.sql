-- Panel /admin (ADM-1): personas, roles, bloqueo y cuenta de prueba. Idempotente: corre en cada db:migrate.
--
-- Mismo patrón que 0054: funciones SECURITY DEFINER con search_path fijo, objetos calificados, REVOKE de
-- PUBLIC, EXECUTE solo para authenticated y la barrera `app_admins` adentro. La app (ADMIN_EMAILS) decide qué
-- se muestra; la base exige además la fila en `app_admins`.
--
--   1. `user_roles` y `admin_events` (0078): sin acceso directo de la app. La persona lee sus roles con
--      my_roles(); los admins los cambian con admin_person_role y cada cambio queda en admin_events.
--   2. Bloqueo: `users.blocked_at`. Una cuenta bloqueada no inicia sesión (auth_user_by_email no la devuelve)
--      y sus sesiones abiertas dejan de valer (user_session_version da null: la app la manda a cerrar
--      sesión). Al bloquear sube session_version, así que desbloquear no revive los JWT viejos.
--   3. Listado y ficha de personas para el panel, y el resumen de pendientes de la portada.
--
-- Nunca se bloquea a un admin ni a la propia cuenta: un error de un clic no deja el panel sin dueño.

ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_roles" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_roles_definer_all" ON "user_roles";
CREATE POLICY "user_roles_definer_all" ON "user_roles" FOR ALL TO CURRENT_USER
  USING (true) WITH CHECK (true);
REVOKE ALL ON "user_roles" FROM authenticated;

ALTER TABLE "admin_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admin_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_events_definer_select" ON "admin_events";
CREATE POLICY "admin_events_definer_select" ON "admin_events" FOR SELECT TO CURRENT_USER
  USING (true);
DROP POLICY IF EXISTS "admin_events_definer_insert" ON "admin_events";
CREATE POLICY "admin_events_definer_insert" ON "admin_events" FOR INSERT TO CURRENT_USER
  WITH CHECK (true);
REVOKE ALL ON "admin_events" FROM authenticated;

-- ─── Login y sesión: una cuenta bloqueada no entra y pierde las sesiones abiertas ───────────────────────
-- Redefine las de 0003 y 0011 con el mismo cuerpo más el filtro de bloqueo (corren antes que este archivo).
CREATE OR REPLACE FUNCTION public.auth_user_by_email(p_email text)
RETURNS TABLE (id uuid, password_hash text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT u.id, u.password_hash FROM public.users u
   WHERE u.email = lower(btrim(p_email)) AND u.blocked_at IS NULL
   LIMIT 1
$fn$;
REVOKE ALL ON FUNCTION public.auth_user_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_user_by_email(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.user_session_version(p_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT u.session_version FROM public.users u WHERE u.id = p_id AND u.blocked_at IS NULL
$fn$;
REVOKE ALL ON FUNCTION public.user_session_version(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_session_version(uuid) TO authenticated;

-- ─── Roles propios ─────────────────────────────────────────────────────────────────────────────────────
-- Los roles de la sesión (hoy, a lo sumo 'tester'). Sin parámetros: solo responde por auth.uid().
DROP FUNCTION IF EXISTS public.my_roles();
CREATE FUNCTION public.my_roles()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT coalesce(array_agg(r.role ORDER BY r.role), '{}'::text[])
    FROM public.user_roles r WHERE r.user_id = auth.uid()
$fn$;
REVOKE ALL ON FUNCTION public.my_roles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_roles() TO authenticated;

-- ─── Listado de personas ───────────────────────────────────────────────────────────────────────────────
-- Filtros: todas | plan_activo | sin_plan | vencen_7 | vencidos | testers | admins | bloqueadas | prueba |
-- sin_onboarding. Búsqueda por email o nombre (sin distinguir mayúsculas). Página de 50 como máximo.
-- `total` repite en cada fila cuántas personas cumplen el filtro (para paginar sin otra consulta).
DROP FUNCTION IF EXISTS public.admin_people_list(text, text, integer, integer);
CREATE FUNCTION public.admin_people_list(
  p_query text DEFAULT NULL,
  p_filter text DEFAULT 'todas',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, email text, name text, created_at timestamptz, is_test boolean, blocked_at timestamptz,
  onboarded boolean, plan text, plan_until timestamptz, plan_source text,
  is_admin boolean, is_tester boolean, last_ai_at timestamptz, total bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
#variable_conflict use_column
DECLARE
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  v_filter text := coalesce(nullif(btrim(p_filter), ''), 'todas');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_people: no autorizado';
  END IF;
  RETURN QUERY
    WITH base AS (
      SELECT u.id, u.email, u.name, u.created_at, u.is_test, u.blocked_at,
             (p.user_id IS NOT NULL) AS onboarded,
             coalesce(p.plan, 'gratis') AS plan, p.plan_until, p.plan_source,
             EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = u.id) AS is_admin,
             EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = 'tester') AS is_tester
        FROM public.users u
        LEFT JOIN public.profiles p ON p.user_id = u.id
       WHERE (v_q IS NULL
              OR u.email ILIKE '%' || replace(replace(v_q, '%', '\%'), '_', '\_') || '%'
              OR coalesce(u.name, '') ILIKE '%' || replace(replace(v_q, '%', '\%'), '_', '\_') || '%')
    ), filtrada AS (
      SELECT b.* FROM base b
       WHERE CASE v_filter
               WHEN 'plan_activo' THEN b.plan <> 'gratis' AND (b.plan_until IS NULL OR b.plan_until > now())
               WHEN 'sin_plan' THEN b.plan = 'gratis'
               WHEN 'vencen_7' THEN b.plan <> 'gratis' AND b.plan_until > now()
                                    AND b.plan_until <= now() + interval '7 days'
               WHEN 'vencidos' THEN b.plan <> 'gratis' AND b.plan_until <= now()
               WHEN 'testers' THEN b.is_tester
               WHEN 'admins' THEN b.is_admin
               WHEN 'bloqueadas' THEN b.blocked_at IS NOT NULL
               WHEN 'prueba' THEN b.is_test
               WHEN 'sin_onboarding' THEN NOT b.onboarded
               ELSE true
             END
    )
    SELECT f.id, f.email, f.name, f.created_at, f.is_test, f.blocked_at, f.onboarded, f.plan,
           f.plan_until, f.plan_source, f.is_admin, f.is_tester,
           (SELECT max(c.created_at) FROM public.llm_calls c WHERE c.user_id = f.id) AS last_ai_at,
           count(*) OVER () AS total
      FROM filtrada f
     ORDER BY f.created_at DESC, f.id
     LIMIT least(greatest(coalesce(p_limit, 50), 1), 50)
    OFFSET greatest(coalesce(p_offset, 0), 0);
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_people_list(text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_people_list(text, text, integer, integer) TO authenticated;

-- ─── Ficha de una persona ──────────────────────────────────────────────────────────────────────────────
-- Datos de la cuenta y conteos de uso. Sin contenido: ni ofertas, ni CV, ni respuestas. Sin filas si no existe.
DROP FUNCTION IF EXISTS public.admin_person_get(uuid);
CREATE FUNCTION public.admin_person_get(p_id uuid)
RETURNS TABLE (
  id uuid, email text, name text, created_at timestamptz, is_test boolean, blocked_at timestamptz,
  terms_version text, onboarded boolean, plan text, plan_until timestamptz, plan_source text,
  is_admin boolean, is_tester boolean, last_ai_at timestamptz,
  jobs bigint, applications bigint, interviews bigint, feedback bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_people: no autorizado';
  END IF;
  RETURN QUERY
    SELECT u.id, u.email, u.name, u.created_at, u.is_test, u.blocked_at, u.terms_version,
           (p.user_id IS NOT NULL), coalesce(p.plan, 'gratis'), p.plan_until, p.plan_source,
           EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = u.id),
           EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = 'tester'),
           (SELECT max(c.created_at) FROM public.llm_calls c WHERE c.user_id = u.id),
           (SELECT count(*) FROM public.jobs j WHERE j.user_id = u.id),
           (SELECT count(*) FROM public.applications ap WHERE ap.user_id = u.id),
           (SELECT count(*) FROM public.interview_sessions s WHERE s.user_id = u.id),
           (SELECT count(*) FROM public.beta_feedback f WHERE f.user_id = u.id)
      FROM public.users u
      LEFT JOIN public.profiles p ON p.user_id = u.id
     WHERE u.id = p_id;
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_person_get(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_person_get(uuid) TO authenticated;

-- Historial de la persona: lo del panel (admin_events) y los cambios de plan (plan_events), los más nuevos
-- primero. Del admin, solo su email. Tope de 50.
DROP FUNCTION IF EXISTS public.admin_person_history(uuid, integer);
CREATE FUNCTION public.admin_person_history(p_id uuid, p_limit integer DEFAULT 30)
RETURNS TABLE (action text, source text, admin_email text, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_people: no autorizado';
  END IF;
  RETURN QUERY
    SELECT h.action, h.source, adm.email, h.created_at
      FROM (
        SELECT e.action, NULL::text AS source, e.admin_id, e.created_at
          FROM public.admin_events e WHERE e.user_id = p_id
        UNION ALL
        SELECT 'plan_' || pe.action, pe.source, pe.admin_id, pe.created_at
          FROM public.plan_events pe WHERE pe.user_id = p_id
      ) h
      LEFT JOIN public.users adm ON adm.id = h.admin_id
     ORDER BY h.created_at DESC
     LIMIT least(greatest(coalesce(p_limit, 30), 1), 50);
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_person_history(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_person_history(uuid, integer) TO authenticated;

-- ─── Cambios sobre una persona ─────────────────────────────────────────────────────────────────────────
-- Devuelven 'ok', 'sin_cambio' (ya estaba así), 'no_existe' o, para el bloqueo, 'propia' / 'es_admin'.
-- Cada cambio queda en admin_events en la misma transacción.

-- Rol tester: lo da o lo saca.
DROP FUNCTION IF EXISTS public.admin_person_role(uuid, text, boolean);
CREATE FUNCTION public.admin_person_role(p_id uuid, p_role text, p_on boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_people: no autorizado';
  END IF;
  IF p_role IS DISTINCT FROM 'tester' THEN
    RAISE EXCEPTION 'admin_person_role: rol desconocido';
  END IF;
  PERFORM 1 FROM public.users u WHERE u.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'no_existe';
  END IF;
  IF p_on THEN
    INSERT INTO public.user_roles (user_id, role, granted_by) VALUES (p_id, p_role, auth.uid())
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.user_roles r WHERE r.user_id = p_id AND r.role = p_role;
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RETURN 'sin_cambio';
  END IF;
  INSERT INTO public.admin_events (user_id, admin_id, action)
  VALUES (p_id, auth.uid(), CASE WHEN p_on THEN 'tester_si' ELSE 'tester_no' END);
  RETURN 'ok';
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_person_role(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_person_role(uuid, text, boolean) TO authenticated;

-- Bloqueo: bloquear sube session_version (cierra las sesiones abiertas); desbloquear solo saca la fecha.
DROP FUNCTION IF EXISTS public.admin_person_block(uuid, boolean);
CREATE FUNCTION public.admin_person_block(p_id uuid, p_on boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_blocked timestamptz;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_people: no autorizado';
  END IF;
  SELECT u.blocked_at INTO v_blocked FROM public.users u WHERE u.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'no_existe';
  END IF;
  IF p_on THEN
    IF p_id = auth.uid() THEN
      RETURN 'propia';
    END IF;
    IF EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = p_id) THEN
      RETURN 'es_admin';
    END IF;
    IF v_blocked IS NOT NULL THEN
      RETURN 'sin_cambio';
    END IF;
    UPDATE public.users
       SET blocked_at = now(), session_version = session_version + 1, updated_at = now()
     WHERE id = p_id;
  ELSE
    IF v_blocked IS NULL THEN
      RETURN 'sin_cambio';
    END IF;
    UPDATE public.users SET blocked_at = NULL, updated_at = now() WHERE id = p_id;
  END IF;
  INSERT INTO public.admin_events (user_id, admin_id, action)
  VALUES (p_id, auth.uid(), CASE WHEN p_on THEN 'bloquear' ELSE 'desbloquear' END);
  RETURN 'ok';
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_person_block(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_person_block(uuid, boolean) TO authenticated;

-- Cuenta de prueba (T-1): fuera de las métricas y sin avisos de vencimiento.
DROP FUNCTION IF EXISTS public.admin_person_test(uuid, boolean);
CREATE FUNCTION public.admin_person_test(p_id uuid, p_on boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_test boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_people: no autorizado';
  END IF;
  SELECT u.is_test INTO v_test FROM public.users u WHERE u.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'no_existe';
  END IF;
  IF v_test = coalesce(p_on, false) THEN
    RETURN 'sin_cambio';
  END IF;
  UPDATE public.users SET is_test = coalesce(p_on, false), updated_at = now() WHERE id = p_id;
  INSERT INTO public.admin_events (user_id, admin_id, action)
  VALUES (p_id, auth.uid(), CASE WHEN p_on THEN 'prueba_si' ELSE 'prueba_no' END);
  RETURN 'ok';
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_person_test(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_person_test(uuid, boolean) TO authenticated;

-- ─── Portada del panel ─────────────────────────────────────────────────────────────────────────────────
-- Solo conteos: lista de espera sin invitar, avisos «Ya pagué» pendientes, planes que vencen en 7 días,
-- feedback nuevo, cuentas bloqueadas, personas (sin las de prueba) y altas de los últimos 7 días.
DROP FUNCTION IF EXISTS public.admin_panel_summary();
CREATE FUNCTION public.admin_panel_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_people: no autorizado';
  END IF;
  RETURN jsonb_build_object(
    'waitlist', (SELECT count(*) FROM public.waitlist w WHERE w.invited_at IS NULL),
    'payment_notices', (SELECT count(*) FROM public.payment_notices n WHERE n.status = 'pendiente'),
    'expiring_7d', (SELECT count(*) FROM public.profiles p
                     WHERE p.plan <> 'gratis' AND p.plan_until > now()
                       AND p.plan_until <= now() + interval '7 days'),
    'feedback_new', (SELECT count(*) FROM public.beta_feedback f WHERE f.status = 'nuevo'),
    'blocked', (SELECT count(*) FROM public.users u WHERE u.blocked_at IS NOT NULL),
    'people', (SELECT count(*) FROM public.users u WHERE NOT u.is_test),
    'new_7d', (SELECT count(*) FROM public.users u
                WHERE NOT u.is_test AND u.created_at > now() - interval '7 days')
  );
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_panel_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_panel_summary() TO authenticated;
