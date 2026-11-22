-- interview_answers (simulador de entrevistas): las respuestas y su devolución. Solo del dueño. Al alta, además,
-- la simulación a la que pertenece tiene que ser de la misma persona: nadie cuelga respuestas de la sesión de
-- otra (la policy de interview_sessions ya acota ese EXISTS a las filas propias). Idempotente.
ALTER TABLE "interview_answers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "interview_answers" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "interview_answers_owner" ON "interview_answers";
CREATE POLICY "interview_answers_owner" ON "interview_answers" FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM "interview_sessions" s
       WHERE s.id = session_id AND s.user_id = auth.uid()
    )
  );
-- Ver 0045: 0030 corre antes que este archivo y retira los permisos de la tabla todavía sin RLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON "interview_answers" TO authenticated;
