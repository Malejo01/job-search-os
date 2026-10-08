-- APLICADO en rls/0000 y rls/0003 desde la 14c. Archivo sin uso: lo borra Mauro.
-- No lo aplica db:migrate. No correrlo a mano: el SQL de abajo está comentado a propósito.

-- users: cada usuario ve solo su fila. Antes `USING (true)`: el rol de la app leía todos los emails.
-- DROP POLICY IF EXISTS "users_read" ON "users";
-- CREATE POLICY "users_read" ON "users" FOR SELECT USING (id = auth.uid());

-- password_reset_tokens: la lectura abierta dejaba listar token_hash + user_id de todos.
-- DROP POLICY IF EXISTS "password_reset_tokens_read" ON "password_reset_tokens";
-- CREATE POLICY "password_reset_tokens_read" ON "password_reset_tokens" FOR SELECT
--   USING (user_id = auth.uid());

-- Bootstrap de /setup por has_any_user() (ahora al final de rls/0003_auth_functions.sql).
-- DROP POLICY IF EXISTS "users_bootstrap_insert" ON "users";
-- CREATE POLICY "users_bootstrap_insert" ON "users" FOR INSERT
--   WITH CHECK (NOT public.has_any_user());
