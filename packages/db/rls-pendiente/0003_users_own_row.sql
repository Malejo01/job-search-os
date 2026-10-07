-- PENDIENTE: se mueve a packages/db/rls/ en la 14c, después del deploy de 14a (JS-103).
-- No lo aplica db:migrate (solo lee rls/). Requiere rls/0003_auth_functions.sql ya aplicado y que el
-- código desplegado lea users por esas funciones o por withUser (el de 14a lo hace).
-- Idempotente.

-- users: cada usuario ve solo su fila. Antes `USING (true)`: el rol de la app leía todos los emails.
DROP POLICY IF EXISTS "users_read" ON "users";
CREATE POLICY "users_read" ON "users" FOR SELECT USING (id = auth.uid());

-- password_reset_tokens: la lectura abierta dejaba listar token_hash + user_id de todos. El link se
-- consume por check_reset_token (SECURITY DEFINER); la app solo ve los tokens del usuario de la sesión.
DROP POLICY IF EXISTS "password_reset_tokens_read" ON "password_reset_tokens";
CREATE POLICY "password_reset_tokens_read" ON "password_reset_tokens" FOR SELECT
  USING (user_id = auth.uid());

-- Bootstrap de /setup: con users_read cerrada, `NOT EXISTS (SELECT 1 FROM users)` ya no vería las
-- filas ajenas y siempre daría verdadero (abriría /setup). La función SECURITY DEFINER sí las ve.
DROP POLICY IF EXISTS "users_bootstrap_insert" ON "users";
CREATE POLICY "users_bootstrap_insert" ON "users" FOR INSERT
  WITH CHECK (NOT public.has_any_user());
