-- Intentos de login por email. Idempotente: corre en cada db:migrate.
--
-- El login llega sin sesión y puede nombrar un email que no existe, así que la tabla no tiene user_id: guarda
-- el sha256 del email normalizado. Con FORCE y sin policies para los roles de la app, nadie la lee ni la
-- escribe de forma directa: solo por las dos funciones de abajo.
ALTER TABLE "login_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "login_attempts" FORCE ROW LEVEL SECURITY;

-- Con FORCE RLS el dueño queda sujeto a las policies si su rol no tiene BYPASSRLS (Neon). TO CURRENT_USER es
-- el rol que aplica la migración, dueño de la tabla y de las funciones; el rol de la app no queda alcanzado.
DROP POLICY IF EXISTS "login_attempts_definer_select" ON "login_attempts";
CREATE POLICY "login_attempts_definer_select" ON "login_attempts" FOR SELECT TO CURRENT_USER USING (true);
DROP POLICY IF EXISTS "login_attempts_definer_insert" ON "login_attempts";
CREATE POLICY "login_attempts_definer_insert" ON "login_attempts" FOR INSERT TO CURRENT_USER WITH CHECK (true);
DROP POLICY IF EXISTS "login_attempts_definer_update" ON "login_attempts";
CREATE POLICY "login_attempts_definer_update" ON "login_attempts" FOR UPDATE TO CURRENT_USER
  USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "login_attempts_definer_delete" ON "login_attempts";
CREATE POLICY "login_attempts_definer_delete" ON "login_attempts" FOR DELETE TO CURRENT_USER USING (true);

-- Reserva un intento ANTES de verificar la contraseña, así una ráfaga en paralelo no pasa el tope: el lock de
-- la fila ordena los pedidos del mismo email. Devuelve false si el email está en espera.
--   * Desde el quinto intento sin login correcto hay espera: 30 s, y se duplica hasta un máximo de 15 minutos.
--   * Un intento rechazado no alarga la espera ni cuenta.
--   * Tras una hora sin intentos, la cuenta vuelve a empezar.
-- El contador se detiene en 20: la espera ya llegó al máximo mucho antes.
DROP FUNCTION IF EXISTS public.login_attempt_begin(text);
CREATE FUNCTION public.login_attempt_begin(p_hash text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_count integer;
  v_locked timestamptz;
  v_last timestamptz;
BEGIN
  IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;
  -- Purga ocasional: los emails inventados no dejan filas para siempre.
  IF random() < 0.01 THEN
    DELETE FROM public.login_attempts a WHERE a.last_attempt_at < now() - interval '1 day';
  END IF;
  INSERT INTO public.login_attempts (email_hash) VALUES (p_hash) ON CONFLICT (email_hash) DO NOTHING;
  SELECT a.failed_count, a.locked_until, a.last_attempt_at INTO v_count, v_locked, v_last
    FROM public.login_attempts a WHERE a.email_hash = p_hash FOR UPDATE;
  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RETURN false;
  END IF;
  IF v_last <= now() - interval '1 hour' THEN
    v_count := 0;
  END IF;
  v_count := least(v_count + 1, 20);
  UPDATE public.login_attempts a
     SET failed_count = v_count,
         last_attempt_at = now(),
         locked_until = CASE
           WHEN v_count >= 5
             THEN now() + least(interval '30 seconds' * power(2, v_count - 5), interval '15 minutes')
           END
   WHERE a.email_hash = p_hash;
  RETURN true;
END
$fn$;
REVOKE ALL ON FUNCTION public.login_attempt_begin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.login_attempt_begin(text) TO authenticated;

-- Login correcto: borra los intentos de ese email.
DROP FUNCTION IF EXISTS public.login_attempt_clear(text);
CREATE FUNCTION public.login_attempt_clear(p_hash text)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  DELETE FROM public.login_attempts a WHERE a.email_hash = p_hash
$fn$;
REVOKE ALL ON FUNCTION public.login_attempt_clear(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.login_attempt_clear(text) TO authenticated;
