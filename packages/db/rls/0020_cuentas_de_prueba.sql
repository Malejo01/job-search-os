-- Cuentas de prueba fuera de las métricas de la beta (T-1). `users.is_test` (migración 0065) la marca
-- `admin:test-users --create` después de registrar la cuenta por el camino real. Idempotente: corre en
-- cada db:migrate. No edita el 0009 (ya aplicado): redefine acá, que corre después, las dos funciones de
-- métricas que cuentan personas, con el mismo cuerpo más el filtro `NOT is_test_user(user_id)`.

-- ¿La cuenta es de prueba? Lee users como dueño (users_definer_select, 0003); devuelve solo un booleano.
CREATE OR REPLACE FUNCTION public.is_test_user(p_user uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT coalesce((SELECT u.is_test FROM public.users u WHERE u.id = p_user), false)
$fn$;
REVOKE ALL ON FUNCTION public.is_test_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_test_user(uuid) TO authenticated;

-- C-13 (0009) sin las cuentas de prueba: sus 👍/👎, postulaciones y ofertas no hacen madurar una carrera.
DROP FUNCTION IF EXISTS public.career_maturity_stats();
CREATE FUNCTION public.career_maturity_stats()
RETURNS TABLE (
  role text,
  offers_ok boolean,
  thumbs_ok boolean,
  active_ok boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  WITH offers AS (
    SELECT r AS role, count(*) AS n
      FROM public.public_jobs pj, unnest(pj.role_hints) AS r
     WHERE pj.first_seen_at > now() - interval '30 days'
       AND pj.dedup_of_id IS NULL
     GROUP BY r
  ),
  verdicts AS (
    SELECT j.matched_role AS role,
           count(*) FILTER (WHERE e.human_verdict = 'de_acuerdo') AS up,
           count(*) AS total,
           count(DISTINCT e.user_id) AS people
      FROM public.evaluations e
      JOIN public.jobs j ON j.id = e.job_id
     WHERE e.human_verdict IS NOT NULL
       AND e.human_verdict_at > now() - interval '90 days'
       AND j.matched_role IS NOT NULL
       AND NOT public.is_test_user(e.user_id)
     GROUP BY j.matched_role
  ),
  active AS (
    SELECT DISTINCT user_id FROM (
      SELECT e.user_id FROM public.evaluations e WHERE e.human_verdict_at > now() - interval '30 days'
      UNION ALL
      SELECT a.user_id FROM public.applications a WHERE a.created_at > now() - interval '30 days'
      UNION ALL
      SELECT j.user_id FROM public.jobs j
       WHERE j.created_at > now() - interval '30 days' AND j.public_job_id IS NULL
    ) x
    WHERE NOT public.is_test_user(x.user_id)
  ),
  followers AS (
    SELECT r AS role, count(DISTINCT p.user_id) AS n
      FROM public.profiles p
      JOIN active a ON a.user_id = p.user_id,
           unnest(p.target_roles) AS r
     GROUP BY r
  ),
  roles AS (
    SELECT o.role FROM offers o UNION SELECT v.role FROM verdicts v
  )
  SELECT rs.role,
         coalesce(o.n, 0) >= 100,
         CASE WHEN coalesce(v.people, 0) >= 5 THEN v.up::numeric / v.total >= 0.6 END,
         coalesce(f.n, 0) >= 10
    FROM roles rs
    LEFT JOIN offers o ON o.role = rs.role
    LEFT JOIN verdicts v ON v.role = rs.role
    LEFT JOIN followers f ON f.role = rs.role
$fn$;
REVOKE ALL ON FUNCTION public.career_maturity_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.career_maturity_stats() TO authenticated;

-- C-14 (0009) sin las cuentas de prueba: personas activas, evaluaciones, 👍/👎, postulaciones, entrevistas
-- y gasto por persona se cuentan solo con cuentas reales.
CREATE OR REPLACE FUNCTION public.admin_beta_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_active_7d integer;
  v_active_30d integer;
  v_evals integer;
  v_evals_people integer;
  v_up integer;
  v_down integer;
  v_verdict_people integer;
  v_apps integer;
  v_apps_people integer;
  v_interviews integer;
  v_interviews_people integer;
  v_cost numeric;
  v_cost_people integer;
  v_sources jsonb;
  v_langs jsonb;
  k CONSTANT integer := 3;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_beta_metrics: no autorizado';
  END IF;

  WITH acts AS (
    SELECT e.user_id, e.human_verdict_at AS at FROM public.evaluations e WHERE e.human_verdict_at IS NOT NULL
    UNION ALL
    SELECT a.user_id, a.created_at FROM public.applications a
    UNION ALL
    SELECT j.user_id, j.created_at FROM public.jobs j WHERE j.public_job_id IS NULL
  )
  SELECT count(DISTINCT user_id) FILTER (WHERE at > now() - interval '7 days'),
         count(DISTINCT user_id) FILTER (WHERE at > now() - interval '30 days')
    INTO v_active_7d, v_active_30d
    FROM acts
   WHERE NOT public.is_test_user(acts.user_id);

  SELECT count(*), count(DISTINCT e.user_id)
    INTO v_evals, v_evals_people
    FROM public.evaluations e
   WHERE e.created_at > now() - interval '30 days'
     AND NOT public.is_test_user(e.user_id);

  SELECT count(*) FILTER (WHERE e.human_verdict = 'de_acuerdo'),
         count(*) FILTER (WHERE e.human_verdict = 'en_desacuerdo'),
         count(DISTINCT e.user_id)
    INTO v_up, v_down, v_verdict_people
    FROM public.evaluations e
   WHERE e.human_verdict IS NOT NULL AND e.human_verdict_at > now() - interval '30 days'
     AND NOT public.is_test_user(e.user_id);

  SELECT count(*), count(DISTINCT a.user_id)
    INTO v_apps, v_apps_people
    FROM public.applications a
   WHERE a.created_at > now() - interval '30 days'
     AND NOT public.is_test_user(a.user_id);

  SELECT count(*), count(DISTINCT a.user_id)
    INTO v_interviews, v_interviews_people
    FROM public.applications a
   WHERE a.outcome IN ('entrevista', 'oferta') AND a.outcome_at > now() - interval '30 days'
     AND NOT public.is_test_user(a.user_id);

  -- Gasto operativo: sin las corridas de evals (task eval:*), ni las llamadas sin persona (demo, cron),
  -- ni las de cuentas de prueba
  SELECT coalesce(sum(c.cost_usd), 0), count(DISTINCT c.user_id)
    INTO v_cost, v_cost_people
    FROM public.llm_calls c
   WHERE c.created_at > now() - interval '30 days'
     AND c.task NOT LIKE 'eval:%'
     AND c.user_id IS NOT NULL
     AND NOT public.is_test_user(c.user_id);

  SELECT coalesce(jsonb_object_agg(src, n), '{}'::jsonb) INTO v_sources FROM (
    SELECT pj.source_kind::text AS src, count(*)::int AS n
      FROM public.public_jobs pj
     WHERE pj.first_seen_at > now() - interval '30 days' AND pj.dedup_of_id IS NULL
     GROUP BY 1
  ) s;

  SELECT coalesce(jsonb_object_agg(lang, n), '{}'::jsonb) INTO v_langs FROM (
    SELECT coalesce(pj.lang, 'sin_dato') AS lang, count(*)::int AS n
      FROM public.public_jobs pj
     WHERE pj.first_seen_at > now() - interval '30 days' AND pj.dedup_of_id IS NULL
     GROUP BY 1
  ) l;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'k', k,
    'active_7d', CASE WHEN v_active_7d >= k THEN v_active_7d END,
    'active_30d', CASE WHEN v_active_30d >= k THEN v_active_30d END,
    'evaluations_30d', CASE WHEN v_evals_people >= k THEN v_evals END,
    'verdict_up_30d', CASE WHEN v_verdict_people >= k THEN v_up END,
    'verdict_down_30d', CASE WHEN v_verdict_people >= k THEN v_down END,
    'applications_30d', CASE WHEN v_apps_people >= k THEN v_apps END,
    'interviews_30d', CASE WHEN v_interviews_people >= k THEN v_interviews END,
    'llm_cost_30d_usd', CASE WHEN v_cost_people >= k THEN round(v_cost, 2) END,
    'llm_cost_per_active_30d_usd',
      CASE WHEN v_cost_people >= k AND v_active_30d >= k THEN round(v_cost / v_active_30d, 3) END,
    'offers_by_source_30d', v_sources,
    'offers_by_lang_30d', v_langs
  );
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_beta_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_beta_metrics() TO authenticated;
