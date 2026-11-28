-- Versión del CV adaptada a una oferta (R34-02): cv_offer_versions. Idempotente: corre en cada db:migrate.
--
-- Datos de la persona: ve, crea, cambia y borra SOLO lo suyo. Guarda la propuesta decidida (no un CV); el CV base
-- no se toca. Cae con la cuenta y con la oferta (FK con ON DELETE CASCADE y entrada en USER_TABLES).
--
-- Permisos: 0030 retira los de toda tabla sin RLS en el momento en que corre y esta se activa acá, después; por eso
-- se dan explícitos (como en 0075).

ALTER TABLE "cv_offer_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cv_offer_versions" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "cv_offer_versions" TO authenticated;

DROP POLICY IF EXISTS "cv_offer_versions_owner_select" ON "cv_offer_versions";
CREATE POLICY "cv_offer_versions_owner_select" ON "cv_offer_versions" FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "cv_offer_versions_owner_insert" ON "cv_offer_versions";
CREATE POLICY "cv_offer_versions_owner_insert" ON "cv_offer_versions" FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "cv_offer_versions_owner_update" ON "cv_offer_versions";
CREATE POLICY "cv_offer_versions_owner_update" ON "cv_offer_versions" FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "cv_offer_versions_owner_delete" ON "cv_offer_versions";
CREATE POLICY "cv_offer_versions_owner_delete" ON "cv_offer_versions" FOR DELETE
  USING (user_id = auth.uid());
