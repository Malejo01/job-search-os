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

-- Con FORCE RLS el dueño de las funciones del canje queda sujeto a las policies si su rol no
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

-- Canje + alta del usuario: lo hace register_with_invitation_v3 (0003), en un solo paso atómico. La
-- primera versión de esa función (register_with_invitation, sin términos ni token de ingesta) se
-- retiró (JS-124): desde JS-113 nadie la llamaba y el rol de la app ya no podía ejecutarla. El DROP
-- va acá, y no solo borrando el CREATE, porque este archivo corre en cada db:migrate y el DROP limpia
-- las bases donde la función todavía existe.
DROP FUNCTION IF EXISTS public.register_with_invitation(text, text, text, text, text);
