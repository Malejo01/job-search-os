-- Tablero de gasto de IA (/settings/costos), solo para admins (app_admins). Devuelve un jsonb de
-- agregados de `llm_calls` de los últimos p_days días: por día (hora de Argentina), por tarea y por
-- modelo, más los totales. Ninguna fila individual, id de persona ni texto. Mismo patrón que
-- admin_beta_metrics (0009): search_path fijo, REVOKE de PUBLIC, EXECUTE solo para authenticated y la
-- barrera `app_admins` adentro. Lee `llm_calls` por la policy `llm_calls_definer_select` (0009).
-- Idempotente: corre en cada db:migrate.
--
-- Qué cuenta como llamada: lo mismo que los topes de gasto (`NOT_MODEL_CALLS` en
-- packages/adapters/src/llm/spend.ts): quedan afuera las reservas, el inicio de charla y los marcadores.
-- Si esa lista cambia, cambia acá.
--
-- Respaldo: `llm_calls` no tiene una columna que lo marque. Una fila es una entrada del modelo de
-- respaldo cuando su modelo es el `fallback_model` actual de su tarea en `model_routing` y no el
-- principal. Si se cambia el routing, el pasado se lee con el routing de hoy (aproximación a propósito).
--
-- El gasto suma solo `cost_usd` real: las llamadas sin tarifa (cost_usd null) se cuentan aparte en
-- `unpriced` y no suman USD; los intentos fallidos sin costo no se estiman acá.
DROP FUNCTION IF EXISTS public.admin_llm_spend_board(integer);
CREATE FUNCTION public.admin_llm_spend_board(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 90);
  v_tz CONSTANT text := 'America/Argentina/Buenos_Aires';
  v_today date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_since timestamptz;
  v_result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_llm_spend_board: no autorizado';
  END IF;

  -- Desde el inicio (en Argentina) del día más viejo de la ventana
  v_since := ((v_today - (v_days - 1))::timestamp) AT TIME ZONE v_tz;

  WITH base AS MATERIALIZED (
    SELECT (c.created_at AT TIME ZONE v_tz)::date AS day,
           c.task,
           c.model,
           coalesce(c.cost_usd, 0)::float8 AS usd,
           c.ok,
           (c.ok AND c.cost_usd IS NULL) AS unpriced,
           coalesce(r.fallback_model IS NOT NULL AND c.model = r.fallback_model AND c.model <> r.model, false)
             AS fallback
      FROM public.llm_calls c
      LEFT JOIN public.model_routing r ON r.task = c.task
     WHERE c.created_at >= v_since
       AND c.task NOT IN ('cv_reserve', 'llm_reserve', 'cv_start', 'budget_alert', 'assistant_event', 'profile_read')
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'days', v_days,
    'daily', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'day', to_char(t.day, 'YYYY-MM-DD'), 'usd', t.usd, 'calls', t.calls, 'failed', t.failed
             ) ORDER BY t.day), '[]'::jsonb)
        FROM (SELECT day, sum(usd) AS usd, count(*)::int AS calls,
                     count(*) FILTER (WHERE NOT ok)::int AS failed
                FROM base GROUP BY day) t),
    'by_task', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'task', t.task, 'usd', t.usd, 'calls', t.calls, 'failed', t.failed,
               'fallbacks', t.fallbacks
             ) ORDER BY t.usd DESC, t.task), '[]'::jsonb)
        FROM (SELECT task, sum(usd) AS usd, count(*)::int AS calls,
                     count(*) FILTER (WHERE NOT ok)::int AS failed,
                     count(*) FILTER (WHERE fallback)::int AS fallbacks
                FROM base GROUP BY task) t),
    'by_model', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'model', t.model, 'usd', t.usd, 'calls', t.calls, 'failed', t.failed
             ) ORDER BY t.usd DESC, t.model), '[]'::jsonb)
        FROM (SELECT model, sum(usd) AS usd, count(*)::int AS calls,
                     count(*) FILTER (WHERE NOT ok)::int AS failed
                FROM base GROUP BY model) t),
    'totals', (
      SELECT jsonb_build_object(
               'usd', coalesce(sum(usd), 0), 'calls', count(*)::int,
               'failed', count(*) FILTER (WHERE NOT ok)::int,
               'fallbacks', count(*) FILTER (WHERE fallback)::int,
               'unpriced', count(*) FILTER (WHERE unpriced)::int)
        FROM base)
  ) INTO v_result;

  RETURN v_result;
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_llm_spend_board(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_llm_spend_board(integer) TO authenticated;
