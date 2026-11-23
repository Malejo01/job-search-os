-- Aviso de anomalía de gasto de IA (/settings/salud), solo para admins (app_admins). Una consulta
-- agregada sobre `llm_calls` (índice llm_calls_created): por tarea, el gasto de las últimas 24 h y el
-- de los 7 días anteriores a esas 24 h (de now() - 8 días a now() - 24 h). Devuelve solo las tareas que
-- gastaron algo en las últimas 24 h; la regla (3 veces el promedio diario, gasto mínimo de USD 0,10) la aplica
-- el código (packages/pipeline/src/llm-spend-anomaly.ts). Sin ids ni emails de personas. Mismo patrón
-- que admin_llm_spend_board (0055): search_path fijo, REVOKE de PUBLIC, EXECUTE solo para authenticated.
-- Lee `llm_calls` por la policy `llm_calls_definer_select` (0009). Idempotente.
--
-- Mismas tareas excluidas que en 0055 y que `NOT_MODEL_CALLS` (packages/adapters/src/llm/spend.ts):
-- si esa lista cambia, cambia acá y en 0055. Suma solo `cost_usd` real.
DROP FUNCTION IF EXISTS public.admin_llm_spend_anomalies();
CREATE FUNCTION public.admin_llm_spend_anomalies()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_llm_spend_anomalies: no autorizado';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'task', t.task, 'usd_24h', t.usd_24h, 'usd_prev_7d', t.usd_prev_7d
         ) ORDER BY t.usd_24h DESC, t.task), '[]'::jsonb)
    INTO v_result
    FROM (
      SELECT c.task,
             coalesce(sum(coalesce(c.cost_usd, 0)) FILTER (WHERE c.created_at >= now() - interval '24 hours'), 0)::float8
               AS usd_24h,
             coalesce(sum(coalesce(c.cost_usd, 0)) FILTER (WHERE c.created_at < now() - interval '24 hours'), 0)::float8
               AS usd_prev_7d
        FROM public.llm_calls c
       WHERE c.created_at >= now() - interval '8 days'
         AND c.task NOT IN ('cv_reserve', 'llm_reserve', 'cv_start', 'budget_alert', 'assistant_event', 'profile_read')
       GROUP BY c.task
      HAVING coalesce(sum(coalesce(c.cost_usd, 0)) FILTER (WHERE c.created_at >= now() - interval '24 hours'), 0) > 0
    ) t;

  RETURN v_result;
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_llm_spend_anomalies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_llm_spend_anomalies() TO authenticated;
