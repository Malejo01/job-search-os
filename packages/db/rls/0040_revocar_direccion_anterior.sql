-- Revocar la dirección anterior de una rotación (alias de gracia). Idempotente: corre en cada db:migrate.
-- La app no puede escribir previous_inbound_address / previous_inbound_until (0034): si pudiera, una persona
-- se asignaría como alias la dirección vieja de otra. Esta función hace una sola cosa y solo para la sesión:
-- limpia el alias del perfil de quien la llama (app.user_id de la transacción). Sin sesión no hace nada.
CREATE OR REPLACE FUNCTION public.revoke_previous_inbound_address()
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_rows integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.profiles
     SET previous_inbound_address = NULL,
         previous_inbound_until = NULL,
         updated_at = now()
   WHERE user_id = v_uid
     AND previous_inbound_address IS NOT NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END
$fn$;
REVOKE ALL ON FUNCTION public.revoke_previous_inbound_address() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_previous_inbound_address() TO authenticated;
