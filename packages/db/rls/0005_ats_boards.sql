-- Boards públicos de ATS que descarga el pool (ronda 47). Tabla global, sin user_id ni datos de personas.
-- Igual que public_job_fetches (0004): ENABLE sin FORCE y SIN policies. La app (jobsearch_app) no la lee
-- ni la escribe; solo el cron, con la conexión de servicio (dueña, saltea RLS).
-- Idempotente: corre en cada db:migrate.

ALTER TABLE "ats_boards" ENABLE ROW LEVEL SECURITY;
