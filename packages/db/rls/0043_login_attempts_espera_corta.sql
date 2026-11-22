-- Intentos de login: sin deadlock entre pedidos paralelos. Idempotente: corre en cada db:migrate.
--
-- Reemplaza login_attempt_begin de 0029 (no se edita: esta versión corre después y la pisa con DROP + CREATE).
-- Los topes y las esperas son los de 0029 (email + IP: 5 intentos; email solo: 50; espera de 1, 2, 4, 8 y 15
-- minutos como máximo; el contador de email solo no vuelve a cero al vencer la espera). Lo que cambia es la forma
-- de crear y bloquear las filas: antes un INSERT … ON CONFLICT DO NOTHING seguido de SELECT … FOR UPDATE dejaba un
-- hueco en el que un login_attempt_clear podía borrar la fila y otro pedido volver a crearla, y dos pedidos
-- quedaban cruzados (deadlock). Ahora cada fila se crea o se bloquea en la misma sentencia.
-- Restablecer la contraseña siempre destraba (login_attempt_clear, 0044: borra todas las filas del email).
-- Orden de locks: primero el candado de la persona (advisory, por prefijo del email), después la fila por email
-- y la de la IP; clear toma el mismo candado desde 0044.
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
  -- Candado de la persona (prefijo del email) hasta el fin de la transacción: begin y clear del mismo email se
  -- ordenan en una sola cola. Los locks de fila solos no alcanzan: si la fila por email todavía no está
  -- confirmada, clear no la ve, la saltea y queda cruzado con un begin sobre la fila de una IP (deadlock).
  PERFORM pg_advisory_xact_lock(hashtextextended('login_attempts:' || left(p_hash, 32), 0));
  v_ip_key := left(p_hash, 32)
    || left(encode(sha256(convert_to(p_hash || ':' || coalesce(p_ip_hash, '-'), 'UTF8')), 'hex'), 32);
  -- Cada fila se crea o se bloquea en la misma sentencia (upsert que devuelve la fila bloqueada): sin hueco entre
  -- insertar y bloquear, un login_attempt_clear que borre la fila en el medio no deja a dos pedidos cruzados.
  -- Siempre en el mismo orden (primero la fila por email), así los pedidos en paralelo se ordenan sin cruzarse.
  INSERT INTO public.login_attempts AS a (email_hash) VALUES (p_hash)
    ON CONFLICT (email_hash) DO UPDATE SET email_hash = excluded.email_hash
    RETURNING a.failed_count, a.locked_until, a.last_attempt_at INTO v_email_count, v_email_locked, v_email_last;
  INSERT INTO public.login_attempts AS a (email_hash) VALUES (v_ip_key)
    ON CONFLICT (email_hash) DO UPDATE SET email_hash = excluded.email_hash
    RETURNING a.failed_count, a.locked_until, a.last_attempt_at INTO v_ip_count, v_ip_locked, v_ip_last;
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
  -- Fila por email solo: el contador NO vuelve a cero al vencer la espera (solo con un login correcto, el reset
  -- de contraseña o una hora sin intentos). Cada vez que se pasa el tope la espera crece: 1, 2, 4, 8 y 15 minutos
  -- como máximo.
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
