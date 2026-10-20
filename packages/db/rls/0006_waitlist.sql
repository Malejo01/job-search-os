-- Lista de espera de la vitrina pública (ronda 63). Idempotente: corre en cada db:migrate.
-- Son personas sin cuenta, así que no hay user_id ni policy por usuario. La tabla queda con RLS activo y
-- SIN policies (como ats_boards, 0005, sin FORCE para que el dueño de la función no dependa de BYPASSRLS):
-- el rol de la app (jobsearch_app) no puede leer, insertar, actualizar ni borrar directo.

ALTER TABLE "waitlist" ENABLE ROW LEVEL SECURITY;
-- Cinturón además del RLS: ni siquiera el privilegio de tabla (los default privileges de 0003/0004
-- se lo darían a authenticated). El rol de la app es miembro de authenticated.
REVOKE ALL ON "waitlist" FROM authenticated;
REVOKE ALL ON "waitlist" FROM jobsearch_app;

-- Único camino de escritura. Es SECURITY DEFINER (corre como el dueño) porque la app no puede leer la
-- tabla: ni el control de duplicados ni el límite por IP pueden hacerse desde afuera sin darle SELECT.
-- Devuelve 'ok' | 'duplicate' | 'rate_limited'. La capa web responde igual a ok y duplicate para no
-- revelar qué emails están anotados.
CREATE OR REPLACE FUNCTION public.waitlist_join(
  p_name text,
  p_email text,
  p_role text,
  p_heard_from text,
  p_ip_hash text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  -- Topes anti-abuso. Por IP: 5 pedidos por hora. Globales: 30 cada 10 minutos y 300 por día,
  -- contra inundaciones desde muchas IPs. Un pedido legítimo en una beta chica queda muy por debajo.
  c_ip_max constant integer := 5;
  c_burst_max constant integer := 30;
  c_day_max constant integer := 300;
  v_email text := lower(btrim(p_email));
  v_name text := btrim(p_name);
  v_heard text := NULLIF(btrim(p_heard_from), '');
  -- Sin IP el límite igual corre: todos los pedidos sin IP comparten un solo bucket
  v_ip text := coalesce(p_ip_hash, 'none');
  v_inserted integer;
BEGIN
  -- Defensa en profundidad: la capa web ya valida con Zod, acá se corta lo que se haya colado
  IF v_name IS NULL OR char_length(v_name) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'waitlist_join: el nombre no es válido';
  END IF;
  IF v_email IS NULL OR char_length(v_email) NOT BETWEEN 3 AND 254 THEN
    RAISE EXCEPTION 'waitlist_join: el email no es válido';
  END IF;
  IF v_heard IS NOT NULL AND char_length(v_heard) > 200 THEN
    RAISE EXCEPTION 'waitlist_join: el campo "cómo te enteraste" es demasiado largo';
  END IF;

  -- La IP hasheada no se guarda más de un día (la purga diaria hace lo mismo aunque nadie se anote)
  UPDATE public.waitlist SET ip_hash = NULL
   WHERE ip_hash IS NOT NULL AND created_at < now() - interval '24 hours';

  IF (SELECT count(*) FROM public.waitlist
       WHERE ip_hash = v_ip AND created_at > now() - interval '1 hour') >= c_ip_max THEN
    RETURN 'rate_limited';
  END IF;
  IF (SELECT count(*) FROM public.waitlist
       WHERE created_at > now() - interval '10 minutes') >= c_burst_max THEN
    RETURN 'rate_limited';
  END IF;
  IF (SELECT count(*) FROM public.waitlist
       WHERE created_at > now() - interval '24 hours') >= c_day_max THEN
    RETURN 'rate_limited';
  END IF;

  INSERT INTO public.waitlist (email, name, role, heard_from, ip_hash)
    VALUES (v_email, v_name, p_role, v_heard, v_ip)
    ON CONFLICT (email) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN CASE WHEN v_inserted = 1 THEN 'ok' ELSE 'duplicate' END;
END
$fn$;
REVOKE ALL ON FUNCTION public.waitlist_join(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waitlist_join(text, text, text, text, text) TO authenticated;
