-- market_candidates (C8-15, JS-102): candidatos de skills de /market por persona. Solo del dueño (lectura,
-- alta y baja propias), como career_history (0014). Idempotente.
ALTER TABLE "market_candidates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "market_candidates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "market_candidates_owner" ON "market_candidates";
CREATE POLICY "market_candidates_owner" ON "market_candidates" FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
