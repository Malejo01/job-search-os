-- Borrador automático del CV (R33-02): cv_drafts. Idempotente: corre en cada db:migrate.
--
-- Datos de la persona: ve, crea, cambia y borra SOLO lo suyo. Un borrador no es el CV (nada entra a career_history
-- hasta que se confirma). Cae con la cuenta (FK con ON DELETE CASCADE y entrada en USER_TABLES) y a los 30 días sin
-- uso lo borra la limpieza de servicio (`purgeStaleCvDrafts`).
--
-- Permisos: 0030 retira los de toda tabla sin RLS en el momento en que corre y esta se activa acá, después; por eso
-- se dan explícitos (como en 0072).

ALTER TABLE "cv_drafts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cv_drafts" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "cv_drafts" TO authenticated;

DROP POLICY IF EXISTS "cv_drafts_owner_select" ON "cv_drafts";
CREATE POLICY "cv_drafts_owner_select" ON "cv_drafts" FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "cv_drafts_owner_insert" ON "cv_drafts";
CREATE POLICY "cv_drafts_owner_insert" ON "cv_drafts" FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "cv_drafts_owner_update" ON "cv_drafts";
CREATE POLICY "cv_drafts_owner_update" ON "cv_drafts" FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "cv_drafts_owner_delete" ON "cv_drafts";
CREATE POLICY "cv_drafts_owner_delete" ON "cv_drafts" FOR DELETE
  USING (user_id = auth.uid());
