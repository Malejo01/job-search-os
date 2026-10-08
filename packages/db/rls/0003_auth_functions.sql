-- Funciones de cuentas (ronda 14a, JS-103/JS-106). Idempotente: se aplica en cada pnpm db:migrate.
-- Objetivo: que la app no necesite leer `users` con el rol jobsearch_app fuera de su propia fila.
-- Desde la 14c users_read es `id = auth.uid()` (0000): el login, la sesión, el reset, el MCP y
-- /setup andan porque leen por estas funciones. No cambia ni reemplaza ninguna función existente.
--
-- Todas: SECURITY DEFINER (corren como el dueño), search_path fijo, objetos calificados, sin EXECUTE
-- para PUBLIC y con EXECUTE solo para `authenticated` (el rol de la app es miembro, 0005).

-- Con FORCE RLS el dueño de las funciones queda sujeto a las policies si su rol no tiene BYPASSRLS
-- (puede pasar en Neon; Docker y CI son superusuario). Esta policy lo deja leer users sin importar
-- cómo quede users_read; TO CURRENT_USER es el rol que aplica la migración (dueño de tabla y funciones),
-- así que el rol de la app no queda alcanzado.
DROP POLICY IF EXISTS "users_definer_select" ON "users";
CREATE POLICY "users_definer_select" ON "users" FOR SELECT TO CURRENT_USER USING (true);

-- Lo mismo para password_reset_tokens: check_reset_token (más abajo) la lee como dueño cuando
-- password_reset_tokens_read se cierre a la fila propia.
DROP POLICY IF EXISTS "password_reset_tokens_definer_select" ON "password_reset_tokens";
CREATE POLICY "password_reset_tokens_definer_select" ON "password_reset_tokens" FOR SELECT TO CURRENT_USER
  USING (true);

-- Reset de contraseña, paso 2: el link llega SIN sesión. Busca UN token por su hash (sha256, nunca el
-- valor en claro) y devuelve a lo sumo una fila; el rol de la app no puede listar tokens ajenos.
CREATE OR REPLACE FUNCTION public.check_reset_token(p_hash text)
RETURNS TABLE (user_id uuid, expires_at timestamptz, used_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT t.user_id, t.expires_at, t.used_at FROM public.password_reset_tokens t
   WHERE t.token_hash = p_hash LIMIT 1
$fn$;
REVOKE ALL ON FUNCTION public.check_reset_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_reset_token(text) TO authenticated;

-- Login: email normalizado igual que auth.ts (btrim + lower). Devuelve a lo sumo una fila.
CREATE OR REPLACE FUNCTION public.auth_user_by_email(p_email text)
RETURNS TABLE (id uuid, password_hash text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT u.id, u.password_hash FROM public.users u WHERE u.email = lower(btrim(p_email)) LIMIT 1
$fn$;
REVOKE ALL ON FUNCTION public.auth_user_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_user_by_email(text) TO authenticated;

-- Recuperación de contraseña: solo el id (el hash no hace falta para pedir el reset).
CREATE OR REPLACE FUNCTION public.user_id_by_email(p_email text) RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT u.id FROM public.users u WHERE u.email = lower(btrim(p_email)) LIMIT 1
$fn$;
REVOKE ALL ON FUNCTION public.user_id_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_id_by_email(text) TO authenticated;

-- Sesión (requireUserId, /api/session/ended): ¿el usuario del JWT sigue existiendo?
CREATE OR REPLACE FUNCTION public.user_exists(p_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_id)
$fn$;
REVOKE ALL ON FUNCTION public.user_exists(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_exists(uuid) TO authenticated;

-- /setup y la policy users_bootstrap_insert: ¿hay algún usuario?
CREATE OR REPLACE FUNCTION public.has_any_user() RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.users)
$fn$;
REVOKE ALL ON FUNCTION public.has_any_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_any_user() TO authenticated;

-- Setup inicial (JS-045/ADR-012, JS-103): crear EL usuario solo si no hay ninguno. Va acá y no en 0000
-- porque necesita has_any_user(); la función ve todas las filas aunque users_read esté cerrada.
-- En cuanto existe una fila el check es siempre falso (doble candado con `hasAnyUser()` en la app).
DROP POLICY IF EXISTS "users_bootstrap_insert" ON "users";
CREATE POLICY "users_bootstrap_insert" ON "users" FOR INSERT
  WITH CHECK (NOT public.has_any_user());

-- Fallback del MCP sin MCP_USER_ID: el id si hay exactamente un usuario; con 0 o 2+, NULL.
CREATE OR REPLACE FUNCTION public.sole_user_id() RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT CASE WHEN (SELECT count(*) FROM public.users) = 1
              THEN (SELECT u.id FROM public.users u LIMIT 1) END
$fn$;
REVOKE ALL ON FUNCTION public.sole_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sole_user_id() TO authenticated;

-- Registro con aceptación de términos (JS-106). Igual que register_with_invitation (0001), que NO se
-- toca (el código anterior la llama), y además guarda terms_accepted_at = now() y terms_version.
-- Sin versión de términos no se registra (el chequeo de la casilla es del servidor; esto es el cinturón).
CREATE OR REPLACE FUNCTION public.register_with_invitation_v2(
  p_code_hash text,
  p_email text,
  p_password_hash text,
  p_name text,
  p_ingest_domain text,
  p_terms_version text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_invitation uuid;
  v_user uuid := gen_random_uuid();
  v_email text := lower(btrim(p_email));
  v_terms text := NULLIF(btrim(p_terms_version), '');
BEGIN
  IF v_terms IS NULL THEN
    RAISE EXCEPTION 'register_with_invitation_v2: falta la versión de los términos aceptados';
  END IF;
  UPDATE public.invitations
     SET used_at = now(), used_by_user_id = v_user
   WHERE code_hash = p_code_hash
     AND used_at IS NULL
     AND expires_at > now()
     AND (email IS NULL OR lower(email) = v_email)
  RETURNING id INTO v_invitation;
  IF v_invitation IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.users (id, email, name, password_hash, terms_accepted_at, terms_version)
    VALUES (v_user, v_email, NULLIF(btrim(p_name), ''), p_password_hash, now(), v_terms);
  INSERT INTO public.profiles (user_id, display_name, location_country, inbound_address)
    VALUES (v_user, COALESCE(NULLIF(btrim(p_name), ''), split_part(v_email, '@', 1)), 'XX',
            'u_' || left(v_user::text, 8) || '@' || p_ingest_domain);
  RETURN v_user;
END
$fn$;
REVOKE ALL ON FUNCTION public.register_with_invitation_v2(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_with_invitation_v2(text, text, text, text, text, text) TO authenticated;

-- Registro con dirección de ingesta aleatoria (JS-113). Igual que v2, que NO se toca (el código
-- desplegado la llama hasta el merge), pero la dirección ya no se deriva del id: la app genera el
-- token (20 caracteres base32, 100 bits) y la función solo valida el formato y lo guarda.
CREATE OR REPLACE FUNCTION public.register_with_invitation_v3(
  p_code_hash text,
  p_email text,
  p_password_hash text,
  p_name text,
  p_ingest_domain text,
  p_terms_version text,
  p_inbound_local text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_invitation uuid;
  v_user uuid := gen_random_uuid();
  v_email text := lower(btrim(p_email));
  v_terms text := NULLIF(btrim(p_terms_version), '');
  v_domain text := lower(btrim(p_ingest_domain));
BEGIN
  IF v_terms IS NULL THEN
    RAISE EXCEPTION 'register_with_invitation_v3: falta la versión de los términos aceptados';
  END IF;
  IF v_domain IS NULL OR v_domain !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' THEN
    RAISE EXCEPTION 'register_with_invitation_v3: el dominio de ingesta no es válido';
  END IF;
  IF p_inbound_local IS NULL OR p_inbound_local !~ '^[a-z2-7]{20}$' THEN
    RAISE EXCEPTION 'register_with_invitation_v3: el token de la dirección de ingesta no es válido';
  END IF;
  UPDATE public.invitations
     SET used_at = now(), used_by_user_id = v_user
   WHERE code_hash = p_code_hash
     AND used_at IS NULL
     AND expires_at > now()
     AND (email IS NULL OR lower(email) = v_email)
  RETURNING id INTO v_invitation;
  IF v_invitation IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.users (id, email, name, password_hash, terms_accepted_at, terms_version)
    VALUES (v_user, v_email, NULLIF(btrim(p_name), ''), p_password_hash, now(), v_terms);
  INSERT INTO public.profiles (user_id, display_name, location_country, inbound_address)
    VALUES (v_user, COALESCE(NULLIF(btrim(p_name), ''), split_part(v_email, '@', 1)), 'XX',
            'u_' || p_inbound_local || '@' || v_domain);
  RETURN v_user;
END
$fn$;
REVOKE ALL ON FUNCTION public.register_with_invitation_v3(text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_with_invitation_v3(text, text, text, text, text, text, text) TO authenticated;
