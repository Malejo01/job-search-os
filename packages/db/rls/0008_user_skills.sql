-- user_skills (ronda 78): skills que la persona agrega a mano. Solo del dueño; no hay lectura cruzada.
ALTER TABLE "user_skills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_skills" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_skills_owner" ON "user_skills";
CREATE POLICY "user_skills_owner" ON "user_skills" FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
