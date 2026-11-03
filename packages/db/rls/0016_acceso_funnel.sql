-- Embudo de /acceso (C8-2). Idempotente: corre en cada db:migrate.
--
-- Contadores agregados por hora, origen, paso y carrera para ver el pico del QR del 11/11. No hay personas:
-- ni email, ni IP, ni id, ni texto libre (el origen sale de una lista cerrada en el código y la base lo
-- vuelve a validar). Mismo patrón que la lista de espera (0006): RLS activo y SIN policies, la app no lee
-- ni escribe la tabla directo. Suma por acceso_funnel_hit() (sin sesión, como waitlist_join) y el admin
-- lee por acceso_funnel_admin() (barrera app_admins).
--
-- Abuso: cualquiera puede llamar a la función desde /acceso y sumar visitas falsas. Solo infla métricas
-- (no hay datos que leer ni filas por persona), la cardinalidad está acotada por los checks y cada
-- llamada toca una sola fila por hora. La web, además, cuenta como mucho una visita por pestaña.

ALTER TABLE "acceso_funnel" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "acceso_funnel" FROM authenticated;
REVOKE ALL ON "acceso_funnel" FROM jobsearch_app;

CREATE OR REPLACE FUNCTION public.acceso_funnel_hit(
  p_origin text,
  p_step text,
  p_role text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_role text := coalesce(p_role, '');
BEGIN
  -- Defensa en profundidad: la web ya normaliza; los checks de la tabla cortan igual
  IF p_origin IS NULL OR p_origin !~ '^[a-z0-9-]{1,40}$' THEN
    RAISE EXCEPTION 'acceso_funnel_hit: origen inválido';
  END IF;
  IF p_step IS NULL OR p_step NOT IN ('visita', 'empezado', 'carrera', 'enviado', 'tope') THEN
    RAISE EXCEPTION 'acceso_funnel_hit: paso inválido';
  END IF;
  -- La carrera solo va en `carrera` y `enviado`; en el resto se guarda vacía
  IF p_step NOT IN ('carrera', 'enviado') THEN
    v_role := '';
  END IF;
  IF v_role !~ '^[a-z_]{0,40}$' THEN
    RAISE EXCEPTION 'acceso_funnel_hit: carrera inválida';
  END IF;

  INSERT INTO public.acceso_funnel AS f (hour, origin, step, role, count)
    VALUES (date_trunc('hour', now()), p_origin, p_step, v_role, 1)
    ON CONFLICT (hour, origin, step, role) DO UPDATE SET count = f.count + 1;
END
$fn$;
REVOKE ALL ON FUNCTION public.acceso_funnel_hit(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acceso_funnel_hit(text, text, text) TO authenticated;

-- Lectura para /settings/metricas: las filas de los últimos p_days días (1 a 90), con tope de filas.
CREATE OR REPLACE FUNCTION public.acceso_funnel_admin(p_days integer DEFAULT 30)
RETURNS TABLE (
  hour timestamptz,
  origin text,
  step text,
  role text,
  count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'acceso_funnel_admin: no autorizado';
  END IF;
  RETURN QUERY
    SELECT f.hour, f.origin, f.step, f.role, f.count
      FROM public.acceso_funnel f
     WHERE f.hour > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 90))
     ORDER BY f.hour, f.origin, f.step, f.role
     LIMIT 20000;
END
$fn$;
REVOKE ALL ON FUNCTION public.acceso_funnel_admin(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acceso_funnel_admin(integer) TO authenticated;
