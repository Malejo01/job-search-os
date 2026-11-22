-- Intentos de login: login_attempt_clear toma los locks en el mismo orden que login_attempt_begin.
-- Idempotente: corre en cada db:migrate. Reemplaza la versión SQL de 0028.
--
-- begin toma primero la fila por email y después la de la IP. El borrado por prefijo de 0028 recorría las filas
-- en el orden del disco, así que podía tomar la de una IP antes que la del email: dos transacciones cruzadas
-- daban deadlock (un login fallaba y se reintentaba). Ahora clear bloquea primero la fila por email y recién
-- después borra todas las filas de la persona. Antes de eso toma el candado de la persona que también toma begin:
-- sin él, una fila por email todavía sin confirmar no se veía y el cruce seguía siendo posible.
DROP FUNCTION IF EXISTS public.login_attempt_clear(text);
CREATE FUNCTION public.login_attempt_clear(p_hash text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;
  -- Mismo candado de la persona que login_attempt_begin (0043): se ordenan en una sola cola aunque la fila por
  -- email todavía no exista o no esté confirmada.
  PERFORM pg_advisory_xact_lock(hashtextextended('login_attempts:' || left(p_hash, 32), 0));
  PERFORM 1 FROM public.login_attempts a WHERE a.email_hash = p_hash FOR UPDATE;
  DELETE FROM public.login_attempts a WHERE left(a.email_hash, 32) = left(p_hash, 32);
END
$fn$;
REVOKE ALL ON FUNCTION public.login_attempt_clear(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.login_attempt_clear(text) TO authenticated;
