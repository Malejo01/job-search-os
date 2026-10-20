-- Evaluaciones de la demo guiada (ronda 74). Tabla global sin user_id: perfiles inventados contra avisos
-- públicos. Mismo patrón que public_jobs (0004): ENABLE sin FORCE, lectura abierta para jobsearch_app y
-- ninguna policy de INSERT/UPDATE/DELETE; escribe solo la conexión de servicio desde el cron.
-- Idempotente: corre en cada db:migrate.

ALTER TABLE "demo_evaluations" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "demo_evaluations_read" ON "demo_evaluations";
CREATE POLICY "demo_evaluations_read" ON "demo_evaluations" FOR SELECT USING (true);
