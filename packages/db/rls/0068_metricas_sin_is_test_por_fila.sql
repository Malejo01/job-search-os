-- R28-13: admin_beta_metrics() más barata, con el MISMO resultado que la de rls/0020. Idempotente: corre en cada
-- db:migrate.
--
-- Qué cambia (solo el cuerpo; la firma, SECURITY DEFINER, search_path y GRANT son los de siempre):
--   1. `NOT public.is_test_user(col)` se llamaba una vez por fila (es SECURITY DEFINER con SET search_path, así que
--      Postgres no la expande). Ahora es `NOT EXISTS (… users … is_test)`, que el planner resuelve con un anti-join.
--      Mismo criterio que la función: una persona que no está en `users` cuenta como real (is_test_user daba false).
--   2. El bloque «personas activas» recorría TODA la historia de evaluaciones, postulaciones y ofertas y recién
--      después miraba la ventana de 30 días. Ahora el filtro de 30 días va dentro de cada rama del UNION (usa los
--      índices por fecha). Lo que queda afuera no entraba en ninguno de los dos conteos (7 y 30 días), así que el
--      resultado no cambia.
-- En una base con 5.000 ofertas y 5.000 llamadas de IA pasó de ~70 ms a ~4 ms; crece con el volumen, no con las
-- personas. La equivalencia con la versión anterior la prueba `metricas-equivalencia.integration.test.ts`.
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
    SELECT e.user_id, e.human_verdict_at AS at FROM public.evaluations e
     WHERE e.human_verdict_at > now() - interval '30 days'
    UNION ALL
    SELECT a.user_id, a.created_at FROM public.applications a
     WHERE a.created_at > now() - interval '30 days'
    UNION ALL
    SELECT j.user_id, j.created_at FROM public.jobs j
     WHERE j.public_job_id IS NULL AND j.created_at > now() - interval '30 days'
  )
  SELECT count(DISTINCT user_id) FILTER (WHERE at > now() - interval '7 days'),
         count(DISTINCT user_id) FILTER (WHERE at > now() - interval '30 days')
    INTO v_active_7d, v_active_30d
    FROM acts
   WHERE NOT EXISTS (SELECT 1 FROM public.users tu WHERE tu.id = acts.user_id AND tu.is_test);

  SELECT count(*), count(DISTINCT e.user_id)
    INTO v_evals, v_evals_people
    FROM public.evaluations e
   WHERE e.created_at > now() - interval '30 days'
     AND NOT EXISTS (SELECT 1 FROM public.users tu WHERE tu.id = e.user_id AND tu.is_test);

  SELECT count(*) FILTER (WHERE e.human_verdict = 'de_acuerdo'),
         count(*) FILTER (WHERE e.human_verdict = 'en_desacuerdo'),
         count(DISTINCT e.user_id)
    INTO v_up, v_down, v_verdict_people
    FROM public.evaluations e
   WHERE e.human_verdict IS NOT NULL AND e.human_verdict_at > now() - interval '30 days'
     AND NOT EXISTS (SELECT 1 FROM public.users tu WHERE tu.id = e.user_id AND tu.is_test);

  SELECT count(*), count(DISTINCT a.user_id)
    INTO v_apps, v_apps_people
    FROM public.applications a
   WHERE a.created_at > now() - interval '30 days'
     AND NOT EXISTS (SELECT 1 FROM public.users tu WHERE tu.id = a.user_id AND tu.is_test);

  SELECT count(*), count(DISTINCT a.user_id)
    INTO v_interviews, v_interviews_people
    FROM public.applications a
   WHERE a.outcome IN ('entrevista', 'oferta') AND a.outcome_at > now() - interval '30 days'
     AND NOT EXISTS (SELECT 1 FROM public.users tu WHERE tu.id = a.user_id AND tu.is_test);

  -- Gasto operativo: sin las corridas de evals (task eval:*), ni las llamadas sin persona (demo, cron),
  -- ni las de cuentas de prueba
  SELECT coalesce(sum(c.cost_usd), 0), count(DISTINCT c.user_id)
    INTO v_cost, v_cost_people
    FROM public.llm_calls c
   WHERE c.created_at > now() - interval '30 days'
     AND c.task NOT LIKE 'eval:%'
     AND c.user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.users tu WHERE tu.id = c.user_id AND tu.is_test);

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
