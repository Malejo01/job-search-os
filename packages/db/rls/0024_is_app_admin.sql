-- Permisos de administración en la base. Idempotente: se aplica en cada pnpm db:migrate.
-- ADMIN_EMAILS decide qué muestra la app; app_admins es la barrera de la base.

-- Sin parámetros a propósito: responde solo por la sesión (app.user_id de la transacción).
CREATE OR REPLACE FUNCTION public.is_app_admin() RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid())
$fn$;
REVOKE ALL ON FUNCTION public.is_app_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated;

-- Crear invitaciones exige fila en app_admins. La policy vive acá y no en 0001 porque necesita la
-- función de arriba; 0001 solo la borra, así que mientras se aplica la migración nadie puede insertar.
DROP POLICY IF EXISTS "invitations_owner_insert" ON "invitations";
CREATE POLICY "invitations_owner_insert" ON "invitations" FOR INSERT
  WITH CHECK (created_by_user_id = auth.uid() AND public.is_app_admin());

-- ¿La invitación vigente está atada a este email? Una invitación sin email da falso. La usa el registro
-- de las direcciones que figuran en las listas de permisos de la app.
CREATE OR REPLACE FUNCTION public.invitation_is_bound_to_email(p_code_hash text, p_email text)
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
       AND email IS NOT NULL
       AND lower(email) = lower(btrim(p_email))
  )
$fn$;
REVOKE ALL ON FUNCTION public.invitation_is_bound_to_email(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invitation_is_bound_to_email(text, text) TO authenticated;
