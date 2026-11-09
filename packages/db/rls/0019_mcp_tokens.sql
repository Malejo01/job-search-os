-- Tokens personales del MCP (MCP-1). Idempotente: corre en cada db:migrate.
--
-- La persona ve, crea y revoca SOLO sus tokens (withUser + auth.uid()). El valor en claro nunca llega
-- a la base: solo el sha256. El request del MCP llega SIN sesión, así que el token se resuelve por
-- mcp_token_user() (SECURITY DEFINER, abajo), que devuelve a lo sumo una fila y solo a quien ya tiene
-- el hash: el rol de la app no puede listar tokens ajenos.
ALTER TABLE "mcp_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mcp_tokens" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mcp_tokens_owner_select" ON "mcp_tokens";
CREATE POLICY "mcp_tokens_owner_select" ON "mcp_tokens" FOR SELECT
  USING (user_id = auth.uid());

-- Alta: solo propia, sin revocar, con el contador en cero y con vencimiento de a lo sumo 30 días (más
-- 5 minutos de margen por la diferencia de reloj entre la app y la base). La app calcula el vencimiento;
-- esto es el cinturón para que un token nunca nazca con más vigencia.
DROP POLICY IF EXISTS "mcp_tokens_owner_insert" ON "mcp_tokens";
CREATE POLICY "mcp_tokens_owner_insert" ON "mcp_tokens" FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND revoked_at IS NULL
    AND window_count = 0
    AND expires_at <= now() + interval '30 days 5 minutes'
  );

-- La única escritura de la app es revocar: la fila queda propia y revocada (no se puede "des-revocar").
DROP POLICY IF EXISTS "mcp_tokens_owner_revoke" ON "mcp_tokens";
CREATE POLICY "mcp_tokens_owner_revoke" ON "mcp_tokens" FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND revoked_at IS NOT NULL);

-- Borrado de cuenta (user-tables.ts): borra las filas propias de forma explícita; además hay cascade.
DROP POLICY IF EXISTS "mcp_tokens_owner_delete" ON "mcp_tokens";
CREATE POLICY "mcp_tokens_owner_delete" ON "mcp_tokens" FOR DELETE
  USING (user_id = auth.uid());

-- Con FORCE RLS el dueño queda sujeto a las policies si su rol no tiene BYPASSRLS (Neon). Mismo patrón
-- que users_definer_select (0003): TO CURRENT_USER es el rol que aplica la migración (dueño de la tabla
-- y de la función), no el de la app. Las usa solo mcp_token_user().
DROP POLICY IF EXISTS "mcp_tokens_definer_select" ON "mcp_tokens";
CREATE POLICY "mcp_tokens_definer_select" ON "mcp_tokens" FOR SELECT TO CURRENT_USER USING (true);
DROP POLICY IF EXISTS "mcp_tokens_definer_update" ON "mcp_tokens";
CREATE POLICY "mcp_tokens_definer_update" ON "mcp_tokens" FOR UPDATE TO CURRENT_USER
  USING (true) WITH CHECK (true);

-- Resolución del token en cada request del MCP. Por hash (sha256 hex; otro formato no devuelve nada):
--   * revocado, vencido o inexistente → ninguna fila (la app contesta 401 igual en los tres casos);
--   * válido → (user_id, rate_limited). En la misma sentencia marca last_used_at y suma al contador de
--     la ventana de 1 minuto: si la ventana empezó hace 1 minuto o más, arranca otra en 1. Con más de
--     60 llamadas en la ventana, rate_limited = true (la app contesta 429). El UPDATE toma el lock de
--     la fila, así que dos requests concurrentes con el mismo token no pierden cuentas.
-- Mismo patrón que check_reset_token (0003): SECURITY DEFINER, search_path fijo, objetos calificados,
-- REVOKE de PUBLIC y EXECUTE solo para authenticated (el rol de la app es miembro, 0005).
DROP FUNCTION IF EXISTS public.mcp_token_user(text);
CREATE FUNCTION public.mcp_token_user(p_hash text)
RETURNS TABLE (user_id uuid, rate_limited boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_user uuid;
  v_count integer;
BEGIN
  IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;
  UPDATE public.mcp_tokens t
     SET last_used_at = now(),
         window_start = CASE
           WHEN t.window_start IS NULL OR t.window_start <= now() - interval '1 minute' THEN now()
           ELSE t.window_start END,
         window_count = CASE
           WHEN t.window_start IS NULL OR t.window_start <= now() - interval '1 minute' THEN 1
           ELSE least(t.window_count + 1, 1000000) END
   WHERE t.token_hash = p_hash
     AND t.revoked_at IS NULL
     AND t.expires_at > now()
  RETURNING t.user_id, t.window_count INTO v_user, v_count;
  IF v_user IS NULL THEN
    RETURN;
  END IF;
  user_id := v_user;
  rate_limited := v_count > 60;
  RETURN NEXT;
END
$fn$;
REVOKE ALL ON FUNCTION public.mcp_token_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mcp_token_user(text) TO authenticated;
