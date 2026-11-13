-- users_self_update sin permiso sobre columnas sensibles (R11-7). La policy de 0000 limita QUÉ fila puede
-- actualizar una persona (la suya), no QUÉ columnas: con el UPDATE de tabla que hereda `authenticated`,
-- una cuenta podía cambiar su propio `is_test` (sacarse o ponerse la marca de cuenta de prueba), su
-- `email` o su `id`. Una policy no puede mirar columnas, así que se restringe con privilegios por columna.
-- No edita 0000 (ya aplicado). Idempotente: corre en cada db:migrate.
--
-- Columnas que la app actualiza como jobsearch_app (dentro de withUser):
--   password_hash, session_version, updated_at  -> reset de contraseña (apps/web/lib/password-reset.ts)
--   terms_version, terms_accepted_at, updated_at -> re-aceptación de términos (apps/web/lib/terms-status.ts)
-- El alta (register_with_invitation_v3, /setup) y la marca is_test (admin:test-users) corren como dueño o
-- SECURITY DEFINER y no dependen de este privilegio. Una columna nueva que la app deba editar se suma
-- en un archivo rls posterior; por defecto queda sin permiso de UPDATE.

-- jobsearch_app hereda de `authenticated` (0005): hay que quitar el UPDATE de tabla a los dos
REVOKE UPDATE ON TABLE public.users FROM authenticated;
REVOKE UPDATE ON TABLE public.users FROM jobsearch_app;

GRANT UPDATE (password_hash, session_version, terms_version, terms_accepted_at, updated_at)
  ON TABLE public.users TO authenticated;
