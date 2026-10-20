-- Propuesta (ronda 62): rol `jobsearch_cron` con permisos mínimos para `pnpm cron:run` en
-- GitHub Actions, en lugar del dueño de la base. NO es una migración: lo corre Mauro a mano en
-- Neon (SQL Editor, como el dueño), después de revisarlo. La contraseña se elige en el momento
-- y va SOLO al secret DATABASE_URL de GitHub; nunca a este archivo ni al repo.
--
-- Por qué BYPASSRLS: el cron escribe en tablas de varios usuarios (asigna ofertas del pool a cada
-- persona y filtra por user_id explícito, ARCHITECTURE §4), y `public_job_fetches` y `ats_boards`
-- tienen RLS sin policies (rls/0004 y 0005). Lo que gana este rol frente al dueño:
-- - no puede crear, alterar ni borrar tablas, ni cambiar policies;
-- - no lee ni toca `users`, `inbound_emails`, `invitations`, `password_reset_tokens`,
--   `candidate_facts`, `answer_bank`, `llm_calls` ni el resto de lo que no está abajo.
--
-- Verificar antes de correr:
-- 1. Que el dueño de Neon pueda crear un rol con BYPASSRLS. Postgres 16 lo exige; en Neon, los
--    roles de `neon_superuser` suelen poder. Si da error, el rol queda sin BYPASSRLS y esta
--    propuesta no sirve tal cual.
-- 2. Que la lista de tablas siga al día con el código, en `packages/adapters/src/{pool,ingest,
--    market,skills,queue,storage}`. Un permiso que falte hace fallar el cron en rojo, que es lo
--    buscado: falla cerrado.

CREATE ROLE jobsearch_cron WITH LOGIN BYPASSRLS PASSWORD '<elegir-en-el-momento>';
GRANT USAGE ON SCHEMA public TO jobsearch_cron;

-- Pool global: descarga, upsert, bitácora, boards de ATS y mercado por rol
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public_jobs, public_job_skills, public_job_fetches, role_market_snapshots
  TO jobsearch_cron;
GRANT SELECT, UPDATE ON ats_boards TO jobsearch_cron;
GRANT SELECT, INSERT ON companies TO jobsearch_cron;
GRANT SELECT, INSERT, DELETE ON raw_blobs TO jobsearch_cron;
GRANT SELECT ON skills TO jobsearch_cron;

-- Por usuario: ingesta de Get on Board, asignación diaria del pool y encolado de evaluaciones
GRANT SELECT, INSERT, UPDATE, DELETE ON jobs, job_sources, job_skills, job_queue TO jobsearch_cron;
GRANT SELECT ON profiles, evaluation_criteria, evaluations, skill_levels TO jobsearch_cron;

-- Lunes: snapshot de mercado y plan de formación
GRANT SELECT, INSERT, UPDATE, DELETE ON market_snapshots, learning_plan_items TO jobsearch_cron;
GRANT SELECT ON learning_resources TO jobsearch_cron;

-- Después: armar la URL pooled con este usuario y reemplazar el secret DATABASE_URL de GitHub.
-- Para volver atrás, poner otra vez la URL anterior en el secret; el rol se puede dejar o borrar
-- con DROP OWNED BY jobsearch_cron; DROP ROLE jobsearch_cron;
