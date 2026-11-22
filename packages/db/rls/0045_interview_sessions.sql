-- interview_sessions (simulador de entrevistas): las simulaciones de cada persona. Solo del dueño, con
-- lectura, alta, edición y baja propias; no hay lectura cruzada. Idempotente.
ALTER TABLE "interview_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "interview_sessions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "interview_sessions_owner" ON "interview_sessions";
CREATE POLICY "interview_sessions_owner" ON "interview_sessions" FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
-- 0030 retira los permisos de toda tabla sin RLS y corre antes que este archivo: como la tabla ya tiene RLS
-- activo, se los devolvemos acá (la policy sigue acotando cada fila).
GRANT SELECT, INSERT, UPDATE, DELETE ON "interview_sessions" TO authenticated;
