-- Respuestas de un toque a «lo que pide el aviso» (R31-05): requirement_answers. Idempotente: corre en cada db:migrate.
--
-- Datos de la persona: ve, crea, cambia y borra SOLO lo suyo. Una respuesta vale para todas las ofertas que pidan lo
-- mismo (la clave `req_key` sale de `requirementKey` en packages/pipeline), así que no cuelga de ninguna oferta.
-- Cae con la cuenta (FK con ON DELETE CASCADE y entrada en USER_TABLES).
--
-- Permisos: 0030 retira los de toda tabla sin RLS en el momento en que corre y esta se activa acá, después; por eso
-- se dan explícitos (como en 0069).

ALTER TABLE "requirement_answers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "requirement_answers" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "requirement_answers" TO authenticated;

DROP POLICY IF EXISTS "requirement_answers_owner_select" ON "requirement_answers";
CREATE POLICY "requirement_answers_owner_select" ON "requirement_answers" FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "requirement_answers_owner_insert" ON "requirement_answers";
CREATE POLICY "requirement_answers_owner_insert" ON "requirement_answers" FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "requirement_answers_owner_update" ON "requirement_answers";
CREATE POLICY "requirement_answers_owner_update" ON "requirement_answers" FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "requirement_answers_owner_delete" ON "requirement_answers";
CREATE POLICY "requirement_answers_owner_delete" ON "requirement_answers" FOR DELETE
  USING (user_id = auth.uid());
