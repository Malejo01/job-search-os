-- Pool global de ofertas públicas (ADR-014). Tablas sin user_id: son ofertas, no datos de personas.
-- Mismo patrón que companies / model_routing (0000): ENABLE sin FORCE. El servicio escribe con la
-- conexión dueña (saltea RLS); jobsearch_app solo lee. Sin policies de INSERT/UPDATE/DELETE: con RLS
-- activo y sin policy, la app no puede escribir aunque tenga el GRANT genérico de 0000.
-- Idempotente: corre en cada db:migrate.

ALTER TABLE "public_jobs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_jobs_read" ON "public_jobs";
CREATE POLICY "public_jobs_read" ON "public_jobs" FOR SELECT USING (true);

ALTER TABLE "public_job_skills" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_job_skills_read" ON "public_job_skills";
CREATE POLICY "public_job_skills_read" ON "public_job_skills" FOR SELECT USING (true);

ALTER TABLE "role_market_snapshots" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "role_market_snapshots_read" ON "role_market_snapshots";
CREATE POLICY "role_market_snapshots_read" ON "role_market_snapshots" FOR SELECT USING (true);

-- Bitácora de descargas: ninguna policy. La app no la lee ni la escribe; solo el servicio.
ALTER TABLE "public_job_fetches" ENABLE ROW LEVEL SECURITY;
