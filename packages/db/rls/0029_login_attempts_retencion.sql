-- Intentos de login: la purga sale del pedido de login. Idempotente: corre en cada db:migrate.
--
-- Reemplaza login_attempt_begin de 0028 sin la purga ocasional (el 1 % de los pedidos borraba filas dentro del
-- propio login, así que con poco tráfico una fila podía quedar mucho más de un día). Ahora borra las filas con más
-- de un día sin actividad la corrida de retención (packages/adapters/src/retention/purge.ts), que usa el índice
-- login_attempts_last_attempt. El resto de la función no cambia.
DROP FUNCTION IF EXISTS public.login_attempt_begin(text, text);
CREATE FUNCTION public.login_attempt_begin(p_hash text, p_ip_hash text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_ip_key text;
  v_email_count integer;
  v_email_locked timestamptz;
  v_email_last timestamptz;
  v_ip_count integer;
  v_ip_locked timestamptz;
  v_ip_last timestamptz;
BEGIN
  IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;
  IF p_ip_hash IS NOT NULL AND p_ip_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;
  v_ip_key := left(p_hash, 32)
    || left(encode(sha256(convert_to(p_hash || ':' || coalesce(p_ip_hash, '-'), 'UTF8')), 'hex'), 32);
  INSERT INTO public.login_attempts (email_hash) VALUES (p_hash) ON CONFLICT (email_hash) DO NOTHING;
  INSERT INTO public.login_attempts (email_hash) VALUES (v_ip_key) ON CONFLICT (email_hash) DO NOTHING;
  -- Siempre en el mismo orden (primero la fila por email), así los pedidos en paralelo se ordenan sin cruzarse.
  SELECT a.failed_count, a.locked_until, a.last_attempt_at INTO v_email_count, v_email_locked, v_email_last
    FROM public.login_attempts a WHERE a.email_hash = p_hash FOR UPDATE;
  SELECT a.failed_count, a.locked_until, a.last_attempt_at INTO v_ip_count, v_ip_locked, v_ip_last
    FROM public.login_attempts a WHERE a.email_hash = v_ip_key FOR UPDATE;
  IF (v_email_locked IS NOT NULL AND v_email_locked > now())
     OR (v_ip_locked IS NOT NULL AND v_ip_locked > now()) THEN
    RETURN false;
  END IF;
  -- Tras una hora sin intentos, cada contador vuelve a empezar.
  IF v_email_last <= now() - interval '1 hour' THEN
    v_email_count := 0;
  END IF;
  IF v_ip_last <= now() - interval '1 hour' THEN
    v_ip_count := 0;
  END IF;
  v_email_count := least(v_email_count + 1, 65);
  v_ip_count := least(v_ip_count + 1, 20);
  UPDATE public.login_attempts a
     SET failed_count = v_email_count,
         last_attempt_at = now(),
         locked_until = CASE
           WHEN v_email_count >= 50
             THEN now() + least(interval '1 minute' * power(2, v_email_count - 50), interval '15 minutes')
           END
   WHERE a.email_hash = p_hash;
  UPDATE public.login_attempts a
     SET failed_count = v_ip_count,
         last_attempt_at = now(),
         locked_until = CASE
           WHEN v_ip_count >= 5
             THEN now() + least(interval '1 minute' * power(2, v_ip_count - 5), interval '15 minutes')
           END
   WHERE a.email_hash = v_ip_key;
  RETURN true;
END
$fn$;
REVOKE ALL ON FUNCTION public.login_attempt_begin(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.login_attempt_begin(text, text) TO authenticated;
