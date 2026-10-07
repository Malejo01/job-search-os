-- Registro por invitación (JS-091). Idempotente: se aplica en cada pnpm db:migrate.
-- invitations no tiene user_id: el dueño es created_by_user_id. La app solo ve y revoca las que creó.
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invitations_owner_select" ON "invitations";
CREATE POLICY "invitations_owner_select" ON "invitations" FOR SELECT
  USING (created_by_user_id = auth.uid());
DROP POLICY IF EXISTS "invitations_owner_insert" ON "invitations";
CREATE POLICY "invitations_owner_insert" ON "invitations" FOR INSERT
  WITH CHECK (created_by_user_id = auth.uid());
DROP POLICY IF EXISTS "invitations_owner_delete" ON "invitations";
CREATE POLICY "invitations_owner_delete" ON "invitations" FOR DELETE
  USING (created_by_user_id = auth.uid());

-- Limpieza de un diseño descartado (policies de quien canjeó + trigger): con RLS, un UPDATE exige
-- que la fila NUEVA también cumpla las policies de SELECT, así que el canjeador no podía poner
-- used_by_user_id en NULL (la fila dejaba de ser visible para él). Se resuelve con
-- release_invitations() más abajo.
DROP TRIGGER IF EXISTS invitations_guard_update ON public.invitations;
DROP FUNCTION IF EXISTS public.invitations_guard_update();
DROP POLICY IF EXISTS "invitations_redeemer_select" ON "invitations";
DROP POLICY IF EXISTS "invitations_redeemer_release" ON "invitations";

-- Con FORCE RLS el dueño de register_with_invitation queda sujeto a las policies si su rol no
-- tiene BYPASSRLS (puede pasar en Neon; Docker y CI son superusuario). TO CURRENT_USER se resuelve
-- al rol que aplica la migración (dueño de las tablas y de la función): el rol de la app no
-- queda alcanzado por estas policies.
DROP POLICY IF EXISTS "users_registration_insert" ON "users";
CREATE POLICY "users_registration_insert" ON "users" FOR INSERT TO CURRENT_USER
  WITH CHECK (true);
DROP POLICY IF EXISTS "profiles_registration_insert" ON "profiles";
CREATE POLICY "profiles_registration_insert" ON "profiles" FOR INSERT TO CURRENT_USER
  WITH CHECK (true);
DROP POLICY IF EXISTS "invitations_definer_select" ON "invitations";
CREATE POLICY "invitations_definer_select" ON "invitations" FOR SELECT TO CURRENT_USER
  USING (true);
DROP POLICY IF EXISTS "invitations_definer_update" ON "invitations";
CREATE POLICY "invitations_definer_update" ON "invitations" FOR UPDATE TO CURRENT_USER
  USING (true) WITH CHECK (true);

-- Borrado de cuenta (JS-092): quien canjeó se desvincula de las invitaciones que usó (used_by_user_id
-- y email a NULL; la fila queda como registro de quien invitó). Solo puede desvincularse a sí mismo:
-- el parámetro tiene que coincidir con auth.uid() (app.user_id de la transacción) y la función no
-- toca ninguna otra columna. Devuelve cuántas filas desvinculó.
CREATE OR REPLACE FUNCTION public.release_invitations(p_user_id uuid) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_count integer;
BEGIN
  IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'release_invitations: solo se puede desvincular la cuenta propia';
  END IF;
  UPDATE public.invitations SET used_by_user_id = NULL, email = NULL WHERE used_by_user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$fn$;
REVOKE ALL ON FUNCTION public.release_invitations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_invitations(uuid) TO authenticated;

-- Pre-chequeo barato (solo lectura) para no gastar scrypt en códigos que no sirven.
CREATE OR REPLACE FUNCTION public.invitation_is_redeemable(p_code_hash text, p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.invitations
     WHERE code_hash = p_code_hash
       AND used_at IS NULL
       AND expires_at > now()
       AND (email IS NULL OR lower(email) = lower(btrim(p_email)))
  )
$fn$;
REVOKE ALL ON FUNCTION public.invitation_is_redeemable(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invitation_is_redeemable(text, text) TO authenticated;

-- Canje: llega SIN sesión y el rol de la app no puede leer invitaciones ajenas ni insertar en
-- users (solo el bootstrap). Por eso es una función SECURITY DEFINER (corre como dueño, que saltea
-- RLS) que, en un solo paso atómico, canjea el código, crea el usuario y su perfil mínimo.
-- El UPDATE ... WHERE used_at IS NULL toma el lock de la fila: dos canjes concurrentes del mismo
-- código se serializan y el segundo no encuentra fila. Devuelve el id del usuario nuevo, o NULL si
-- el código no existe, está usado, vencido o es de otro email (la app no distingue los casos).
-- Si el email ya tiene cuenta, el INSERT falla por el índice único y la transacción entera se
-- deshace: la invitación NO queda gastada.
CREATE OR REPLACE FUNCTION public.register_with_invitation(
  p_code_hash text,
  p_email text,
  p_password_hash text,
  p_name text,
  p_ingest_domain text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_invitation uuid;
  v_user uuid := gen_random_uuid();
  v_email text := lower(btrim(p_email));
BEGIN
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
  INSERT INTO public.users (id, email, name, password_hash)
    VALUES (v_user, v_email, NULLIF(btrim(p_name), ''), p_password_hash);
  INSERT INTO public.profiles (user_id, display_name, location_country, inbound_address)
    VALUES (v_user, COALESCE(NULLIF(btrim(p_name), ''), split_part(v_email, '@', 1)), 'XX',
            'u_' || left(v_user::text, 8) || '@' || p_ingest_domain);
  RETURN v_user;
END
$fn$;

-- used_by_user_id sin FK a propósito: borrar la cuenta de quien se registró no debe tocar la
-- invitación (queda como registro de quien la creó).
REVOKE ALL ON FUNCTION public.register_with_invitation(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_with_invitation(text, text, text, text, text) TO authenticated;
