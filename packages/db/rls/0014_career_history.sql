-- career_history (C-25, CVC-0): historial confirmado por la persona, fuente del CV. Solo del dueño,
-- con lectura, alta, edición y baja propias; no hay lectura cruzada. Idempotente.
ALTER TABLE "career_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "career_history" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "career_history_owner" ON "career_history";
CREATE POLICY "career_history_owner" ON "career_history" FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
