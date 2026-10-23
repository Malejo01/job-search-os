-- Métricas agregadas de la beta (C-13 y C-14). El rol de la app no lee filas ajenas, así que los
-- agregados entre personas salen de funciones SECURITY DEFINER que devuelven solo números o sí/no,
-- nunca filas ni ids. Mismo patrón que waitlist_admin_* (0006): search_path fijo, objetos calificados,
-- REVOKE de PUBLIC y EXECUTE solo para authenticated. Idempotente: corre en cada db:migrate.
--
-- «Persona activa» en una ventana = hizo algo a mano: un 👍/👎, una postulación o una oferta cargada
-- por ella (manual o por email, sin public_job_id). Las evaluaciones del cron no cuentan: corren
-- aunque la persona no entre. El k-anonimato cuenta PERSONAS distintas, no filas: una sola persona
-- con muchas filas no destapa nada.

-- Con FORCE RLS el dueño de las funciones queda sujeto a las policies si su rol no tiene BYPASSRLS
-- (Neon). Igual que users_definer_select (0003): TO CURRENT_USER es el rol que aplica la migración,
-- dueño de tablas y funciones; el rol de la app no queda alcanzado y sigue viendo solo lo suyo.
-- Ojo para funciones futuras: cualquier SECURITY DEFINER del dueño ve estas tablas completas.
DROP POLICY IF EXISTS "profiles_definer_select" ON "profiles";
CREATE POLICY "profiles_definer_select" ON "profiles" FOR SELECT TO CURRENT_USER USING (true);
DROP POLICY IF EXISTS "jobs_definer_select" ON "jobs";
CREATE POLICY "jobs_definer_select" ON "jobs" FOR SELECT TO CURRENT_USER USING (true);
DROP POLICY IF EXISTS "evaluations_definer_select" ON "evaluations";
CREATE POLICY "evaluations_definer_select" ON "evaluations" FOR SELECT TO CURRENT_USER USING (true);
DROP POLICY IF EXISTS "applications_definer_select" ON "applications";
CREATE POLICY "applications_definer_select" ON "applications" FOR SELECT TO CURRENT_USER USING (true);
DROP POLICY IF EXISTS "llm_calls_definer_select" ON "llm_calls";
CREATE POLICY "llm_calls_definer_select" ON "llm_calls" FOR SELECT TO CURRENT_USER USING (true);

-- C-13 · Por carrera, solo el resultado de cada regla (sí/no), con los umbrales fijos acá y en
-- CAREER_MATURITY_THRESHOLDS (pipeline/src/career-maturity.ts): si cambian, cambian los dos.
-- La puede llamar cualquier sesión (el badge se ve en el mercado). Un booleano no deja reconstruir
-- conteos chicos llamando antes y después de un 👍 propio, y la regla de 👍 ni se evalúa (null) con
-- menos de 5 personas distintas opinando. Las carreras salen solo del pool y de las ofertas
-- asignadas (claves que pone el código), nunca del texto de los perfiles.
--   offers_ok: 100 o más ofertas nuevas del pool en 30 días.
--   thumbs_ok: 60 % o más de 👍 en 90 días, con al menos 5 personas distintas; si no, null.
--   active_ok: 10 o más personas activas en 30 días que siguen la carrera.
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

-- C-14 · Tablero de la beta, solo para admins (app_admins). Devuelve un jsonb de agregados, sin
-- ningún dato individual. k-anonimato sobre personas: cada número vuelve null si sale de menos de 3
-- personas distintas (también el costo, total y por persona). Los conteos del pool (ofertas por
-- fuente e idioma) no son datos de personas y van completos.
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
    FROM acts;

  SELECT count(*), count(DISTINCT e.user_id)
    INTO v_evals, v_evals_people
    FROM public.evaluations e
   WHERE e.created_at > now() - interval '30 days';

  SELECT count(*) FILTER (WHERE e.human_verdict = 'de_acuerdo'),
         count(*) FILTER (WHERE e.human_verdict = 'en_desacuerdo'),
         count(DISTINCT e.user_id)
    INTO v_up, v_down, v_verdict_people
    FROM public.evaluations e
   WHERE e.human_verdict IS NOT NULL AND e.human_verdict_at > now() - interval '30 days';

  SELECT count(*), count(DISTINCT a.user_id)
    INTO v_apps, v_apps_people
    FROM public.applications a
   WHERE a.created_at > now() - interval '30 days';

  SELECT count(*), count(DISTINCT a.user_id)
    INTO v_interviews, v_interviews_people
    FROM public.applications a
   WHERE a.outcome IN ('entrevista', 'oferta') AND a.outcome_at > now() - interval '30 days';

  -- Gasto operativo: sin las corridas de evals (task eval:*) ni las llamadas sin persona (demo, cron)
  SELECT coalesce(sum(c.cost_usd), 0), count(DISTINCT c.user_id)
    INTO v_cost, v_cost_people
    FROM public.llm_calls c
   WHERE c.created_at > now() - interval '30 days'
     AND c.task NOT LIKE 'eval:%'
     AND c.user_id IS NOT NULL;

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
