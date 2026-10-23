-- Versión de sesión (S-6, C-5 seguridad S-01). Idempotente: corre en cada db:migrate.
--
-- users_read (0000) deja ver solo la fila propia, y requireUserId tiene que comparar la versión del
-- JWT contra la de la base antes de saber si la sesión sigue valiendo. Igual que user_exists (0003):
-- SECURITY DEFINER, search_path fijo, objetos calificados y solo un entero. Si el usuario no existe,
-- devuelve null (cuenta borrada). La lee como dueño gracias a users_definer_select (0003).
CREATE OR REPLACE FUNCTION public.user_session_version(p_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT u.session_version FROM public.users u WHERE u.id = p_id
$fn$;
REVOKE ALL ON FUNCTION public.user_session_version(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_session_version(uuid) TO authenticated;
