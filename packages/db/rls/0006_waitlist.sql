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
  -- Topes anti-abuso. Por IP: 40 pedidos por hora. Globales: 60 cada 10 minutos y 600 por día, contra
  -- inundaciones desde muchas IPs. Los topes por IP y de ráfaga tienen que dejar pasar una presentación en
  -- vivo con QR (11/11, C5-5): decenas de personas anotándose desde el mismo wifi (una sola IP pública) o
  -- desde datos móviles compartidos (CGNAT) en pocos minutos. Antes eran 5, 30 y 300, y el sexto celular
  -- del mismo salón quedaba afuera. Subirlos es solo cambiar estas constantes (y waitlist.integration.test).
  c_ip_max constant integer := 40;
  c_burst_max constant integer := 60;
  c_day_max constant integer := 600;
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

-- Administración de la lista (ronda 70). La app sigue sin privilegios sobre la tabla: el admin lee,
-- marca y borra solo por estas tres funciones.
-- Quién es admin: ADMIN_EMAILS sigue siendo la fuente para la UI (qué se muestra); app_admins es la
-- barrera de la base. Las funciones exigen que auth.uid() (app.user_id de la transacción) esté en
-- app_admins, así que una sesión común del rol de la app no las puede usar aunque las llame a mano.
-- Mauro carga su user_id con un INSERT puntual (el seed solo lo hace en local/CI). El código además
-- verifica ADMIN_EMAILS antes de llamarlas (isInvitationAdmin en lib/waitlist-admin.ts).
-- Ninguna devuelve ip_hash.
-- Tiene user_id, así que lleva FORCE como el resto (regla del repo): la única policy es la de lectura
-- del rol que aplica la migración (dueño de las funciones), como en 0001. La app no tiene ninguna.
ALTER TABLE "app_admins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app_admins" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app_admins_definer_select" ON "app_admins";
CREATE POLICY "app_admins_definer_select" ON "app_admins" FOR SELECT TO CURRENT_USER
  USING (true);
REVOKE ALL ON "app_admins" FROM authenticated;
REVOKE ALL ON "app_admins" FROM jobsearch_app;

-- La supresión completa (waitlist_admin_delete) borra también la invitación sin usar. invitations
-- tiene FORCE RLS y su única policy de DELETE es por dueño: el rol que aplica la migración (dueño de
-- la función) necesita la suya, como ya tiene la de SELECT y UPDATE (0001).
DROP POLICY IF EXISTS "invitations_definer_delete" ON "invitations";
CREATE POLICY "invitations_definer_delete" ON "invitations" FOR DELETE TO CURRENT_USER
  USING (true);

CREATE OR REPLACE FUNCTION public.waitlist_admin_list(p_limit integer DEFAULT 500)
RETURNS TABLE (
  id uuid,
  name text,
  email text,
  role text,
  heard_from text,
  created_at timestamptz,
  invited_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'waitlist_admin: no autorizado';
  END IF;
  -- Sin invitar primero y, dentro de cada grupo, las más nuevas primero
  RETURN QUERY
    SELECT w.id, w.name, w.email, w.role, w.heard_from, w.created_at, w.invited_at
      FROM public.waitlist w
     ORDER BY (w.invited_at IS NOT NULL), w.created_at DESC, w.id
     LIMIT least(greatest(coalesce(p_limit, 500), 1), 500);
END
$fn$;
REVOKE ALL ON FUNCTION public.waitlist_admin_list(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waitlist_admin_list(integer) TO authenticated;

-- Una sola fila (para invitar sin recorrer el listado). Sin ip_hash.
CREATE OR REPLACE FUNCTION public.waitlist_admin_get(p_id uuid)
RETURNS TABLE (
  id uuid,
  email text,
  invited_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'waitlist_admin: no autorizado';
  END IF;
  RETURN QUERY
    SELECT w.id, w.email, w.invited_at FROM public.waitlist w WHERE w.id = p_id;
END
$fn$;
REVOKE ALL ON FUNCTION public.waitlist_admin_get(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waitlist_admin_get(uuid) TO authenticated;

-- Marca la fila como invitada solo si todavía no lo estaba. Devuelve si cambió.
CREATE OR REPLACE FUNCTION public.waitlist_admin_mark_invited(
  p_id uuid,
  p_invitation_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_changed integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'waitlist_admin: no autorizado';
  END IF;
  UPDATE public.waitlist
     SET invited_at = now(), invitation_id = p_invitation_id
   WHERE id = p_id AND invited_at IS NULL;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed = 1;
END
$fn$;
REVOKE ALL ON FUNCTION public.waitlist_admin_mark_invited(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waitlist_admin_mark_invited(uuid, uuid) TO authenticated;

-- Borrado a pedido de la persona (supresión completa): borra la fila y, si tenía una invitación que
-- nadie usó, también esa invitación (lleva su email). Una ya usada queda como registro. Devuelve si
-- había fila.
CREATE OR REPLACE FUNCTION public.waitlist_admin_delete(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_invitation uuid;
  v_deleted integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'waitlist_admin: no autorizado';
  END IF;
  DELETE FROM public.waitlist WHERE id = p_id RETURNING invitation_id INTO v_invitation;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_invitation IS NOT NULL THEN
    DELETE FROM public.invitations WHERE id = v_invitation AND used_at IS NULL;
  END IF;
  RETURN v_deleted = 1;
END
$fn$;
REVOKE ALL ON FUNCTION public.waitlist_admin_delete(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waitlist_admin_delete(uuid) TO authenticated;
