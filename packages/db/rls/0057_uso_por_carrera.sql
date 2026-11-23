-- Uso por carrera y por semana (R22-04), solo para admins (app_admins). Una fila por carrera, semana y
-- métrica, solo con agregados: nunca ids, emails ni filas de personas. Mismo patrón que
-- admin_founder_counts (0012) y admin_beta_metrics (0009): SECURITY DEFINER, search_path fijo, objetos
-- calificados, REVOKE de PUBLIC y EXECUTE solo para authenticated. Idempotente.
--
-- Semana = lunes a domingo en hora de Buenos Aires; las últimas 8, contando la actual (en curso). Carrera
-- = la primera de profiles.target_roles o, si la lista está vacía, target_role, igual que los cupos de
-- fundador; si no es una clave válida (texto libre, vacía, vieja) cae en «sin_carrera»: el texto de un
-- perfil nunca sale de la función. La lista v_valid_roles es la de ROLE_KEYS y se mantiene a mano; el test
-- packages/db/src/uso-por-carrera-roles.test.ts rompe el CI si difieren. Las cuentas de prueba
-- (users.is_test) no cuentan.
--
-- Métricas y su fuente (cada persona se cuenta una vez por celda):
--   evaluated     evaluations.created_at: ofertas evaluadas, también las del cron (corren aunque la
--                 persona no entre; por eso NO cuentan como actividad).
--   up / down     evaluations.human_verdict_at con 'de_acuerdo' / 'en_desacuerdo'.
--   applications  applications.created_at: postulaciones marcadas.
--   interviews    interview_sessions.created_at: simulaciones de Interview empezadas.
--   coach_chats   charlas distintas (label de llm_calls) con llamadas ok de cv_coach_turn, cv_interview o
--                 cv_write. Una charla que cruza dos semanas cuenta en cada una.
--   cv_reviews    llm_calls ok con task cv_review: diagnósticos del CV.
--   active        personas que hicieron algo a mano en la semana: 👍/👎, postulación, oferta cargada por
--                 ella (jobs sin public_job_id), simulación, charla del coach o diagnóstico del CV.
-- Las filas de llm_calls pierden la persona al borrar la cuenta (rls/0025): esa actividad deja de contar.
--
-- k-anonimato sobre PERSONAS distintas: una celda con menos de 3 NO se devuelve (ni su conteo de acciones,
-- que podría identificar a una persona), y no hay fila de total que permita restar. La pantalla muestra
-- «menos de 3» tanto para la celda ausente como para el cero.
-- Riesgo aceptado (CF-2): comparar consultas en el tiempo podría revelar un grupo chico; lo ve solo un
-- admin de confianza, igual que las otras funciones de métricas.
--
-- Una sola consulta por llamada. Los rangos por fecha sin persona van por índices de fecha (ver schema.ts:
-- evaluations_created_at, evaluations_verdict_at, applications_created_at, interview_sessions_created_at,
-- jobs_manual_created) y llm_calls_task_created (task + fecha). interview_sessions no tenía policy para el
-- dueño de la función: se agrega acá (como las de 0009).
DROP POLICY IF EXISTS "interview_sessions_definer_select" ON "interview_sessions";
CREATE POLICY "interview_sessions_definer_select" ON "interview_sessions" FOR SELECT TO CURRENT_USER USING (true);

DROP FUNCTION IF EXISTS public.admin_usage_by_career();
CREATE FUNCTION public.admin_usage_by_career()
RETURNS TABLE (
  week date,
  career text,
  metric text,
  value integer,
  people integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  k CONSTANT integer := 3;
  v_weeks CONSTANT integer := 8;
  v_tz CONSTANT text := 'America/Argentina/Buenos_Aires';
  v_since timestamptz;
  v_valid_roles CONSTANT text[] := ARRAY[
    'frontend', 'backend', 'fullstack', 'qa', 'data_analyst', 'soporte_it', 'ai_engineer',
    'ux_ui', 'marketing_digital', 'rrhh_it', 'customer_success', 'ciberseguridad',
    'product_manager', 'product_owner', 'project_manager', 'product_marketing',
    'data_engineer', 'solutions_engineer', 'ventas_b2b', 'atencion_cliente',
    'finanzas_contabilidad', 'asistencia_operaciones', 'abogacia', 'administracion_empresas',
    'comunicacion', 'relaciones_internacionales', 'relaciones_publicas',
    'marketing_ia', 'edicion_video', 'creacion_contenido'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_usage_by_career: no autorizado';
  END IF;

  -- Lunes de la semana más vieja, a las 00:00 de Buenos Aires
  v_since := (date_trunc('week', now() AT TIME ZONE v_tz) - (v_weeks - 1) * interval '1 week')
             AT TIME ZONE v_tz;

  RETURN QUERY
  WITH ev AS (
    SELECT e.user_id, e.created_at AS at, 'evaluated'::text AS metric, NULL::text AS label
      FROM public.evaluations e
     WHERE e.created_at >= v_since
    UNION ALL
    SELECT e.user_id, e.human_verdict_at,
           CASE e.human_verdict WHEN 'de_acuerdo' THEN 'up' ELSE 'down' END, NULL
      FROM public.evaluations e
     WHERE e.human_verdict_at >= v_since
       AND e.human_verdict IN ('de_acuerdo', 'en_desacuerdo')
    UNION ALL
    SELECT a.user_id, a.created_at, 'applications', NULL
      FROM public.applications a
     WHERE a.created_at >= v_since
    UNION ALL
    SELECT s.user_id, s.created_at, 'interviews', NULL
      FROM public.interview_sessions s
     WHERE s.created_at >= v_since
    UNION ALL
    SELECT c.user_id, c.created_at, 'cv_reviews', NULL
      FROM public.llm_calls c
     WHERE c.task = 'cv_review' AND c.ok AND c.user_id IS NOT NULL AND c.created_at >= v_since
    UNION ALL
    SELECT c.user_id, c.created_at, 'coach_chats', c.label
      FROM public.llm_calls c
     WHERE c.task IN ('cv_coach_turn', 'cv_interview', 'cv_write')
       AND c.ok AND c.user_id IS NOT NULL AND c.label IS NOT NULL AND c.created_at >= v_since
    UNION ALL
    -- Solo cuenta como actividad (no sale como métrica): oferta cargada a mano o por email
    SELECT j.user_id, j.created_at, 'manual_job', NULL
      FROM public.jobs j
     WHERE j.public_job_id IS NULL AND j.created_at >= v_since
  ),
  keyed AS (
    SELECT (ev.at AT TIME ZONE v_tz)::date AS d,
           ev.user_id,
           ev.metric,
           ev.label,
           CASE
             WHEN coalesce(p.target_roles[1], p.target_role) = ANY (v_valid_roles)
               THEN coalesce(p.target_roles[1], p.target_role)
             ELSE 'sin_carrera'
           END AS career
      FROM ev
      JOIN public.users u ON u.id = ev.user_id AND NOT u.is_test
      LEFT JOIN public.profiles p ON p.user_id = ev.user_id
  ),
  weekly AS (
    SELECT date_trunc('week', kd.d::timestamp)::date AS wk, kd.user_id, kd.metric, kd.label, kd.career
      FROM keyed kd
  ),
  grouped AS (
    SELECT w.wk, w.career, w.metric,
           CASE WHEN w.metric = 'coach_chats' THEN count(DISTINCT w.label) ELSE count(*) END AS n,
           count(DISTINCT w.user_id) AS persons
      FROM weekly w
     WHERE w.metric <> 'manual_job'
     GROUP BY w.wk, w.career, w.metric
    UNION ALL
    SELECT w.wk, w.career, 'active', count(DISTINCT w.user_id), count(DISTINCT w.user_id)
      FROM weekly w
     WHERE w.metric <> 'evaluated'
     GROUP BY w.wk, w.career
  )
  SELECT g.wk, g.career, g.metric, g.n::integer, g.persons::integer
    FROM grouped g
   WHERE g.persons >= k
   ORDER BY g.wk, g.career, g.metric;
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_usage_by_career() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_usage_by_career() TO authenticated;
