-- Policies RLS (docs/SCHEMA.md §RLS). Idempotente: se aplica en cada pnpm db:migrate.
-- FORCE: el dueño de la tabla tampoco saltea RLS (solo BYPASSRLS/superuser). Dueño: user_id = auth.uid(). Tablas via join: por el user_id del job. Catálogo: solo lectura
-- para usuarios; escritura con service_role / owner (bypass RLS). Sin referencias a roles
-- de Supabase en las policies para que sean portables (Docker, CI, Neon).

-- users (ADR-010): lectura abierta al rol de la app para resolver el login por email (un solo usuario,
-- sin registro público); escritura solo del propio registro. Sin INSERT/DELETE para la app.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_read" ON "users";
CREATE POLICY "users_read" ON "users" FOR SELECT USING (true);
DROP POLICY IF EXISTS "users_self_update" ON "users";
CREATE POLICY "users_self_update" ON "users" FOR UPDATE
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
-- Setup inicial (JS-045/ADR-012): crear EL usuario cuando todavía no hay ninguno (reemplaza el
-- paso manual de `pnpm db:seed`). No es registro público: en cuanto existe una fila, este check
-- es siempre falso y la puerta queda cerrada para siempre (doble candado con `hasAnyUser()` en la app).
DROP POLICY IF EXISTS "users_bootstrap_insert" ON "users";
CREATE POLICY "users_bootstrap_insert" ON "users" FOR INSERT
  WITH CHECK (NOT EXISTS (SELECT 1 FROM users));

-- password_reset_tokens (JS-045): mismo caso que users_read. Consumir el link llega SIN sesión
-- (no hay app.user_id todavía), así que necesitamos poder buscar por token_hash antes de saber
-- de quién es; el valor en claro nunca se guarda, así que leer la fila no alcanza para nada.
-- Insert/update sí van con dueño: para entonces ya resolvimos el user_id (withUser).
ALTER TABLE "password_reset_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "password_reset_tokens" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "password_reset_tokens_read" ON "password_reset_tokens";
CREATE POLICY "password_reset_tokens_read" ON "password_reset_tokens" FOR SELECT USING (true);
DROP POLICY IF EXISTS "password_reset_tokens_insert" ON "password_reset_tokens";
CREATE POLICY "password_reset_tokens_insert" ON "password_reset_tokens" FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "password_reset_tokens_update" ON "password_reset_tokens";
CREATE POLICY "password_reset_tokens_update" ON "password_reset_tokens" FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "profiles" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_owner" ON "profiles";
CREATE POLICY "profiles_owner" ON "profiles" FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE "evaluation_criteria" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "evaluation_criteria" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "evaluation_criteria_owner" ON "evaluation_criteria";
CREATE POLICY "evaluation_criteria_owner" ON "evaluation_criteria" FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "jobs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "jobs_owner" ON "jobs";
CREATE POLICY "jobs_owner" ON "jobs" FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE "evaluations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "evaluations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "evaluations_owner" ON "evaluations";
CREATE POLICY "evaluations_owner" ON "evaluations" FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE "applications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "applications" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "applications_owner" ON "applications";
CREATE POLICY "applications_owner" ON "applications" FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "contacts_owner" ON "contacts";
CREATE POLICY "contacts_owner" ON "contacts" FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE "talent_platforms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "talent_platforms" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "talent_platforms_owner" ON "talent_platforms";
CREATE POLICY "talent_platforms_owner" ON "talent_platforms" FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE "skill_levels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "skill_levels" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "skill_levels_owner" ON "skill_levels";
CREATE POLICY "skill_levels_owner" ON "skill_levels" FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE "skill_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "skill_evidence" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "skill_evidence_owner" ON "skill_evidence";
CREATE POLICY "skill_evidence_owner" ON "skill_evidence" FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE "skill_interviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "skill_interviews" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "skill_interviews_owner" ON "skill_interviews";
CREATE POLICY "skill_interviews_owner" ON "skill_interviews" FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE "market_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "market_snapshots" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "market_snapshots_owner" ON "market_snapshots";
CREATE POLICY "market_snapshots_owner" ON "market_snapshots" FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE "learning_plan_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learning_plan_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "learning_plan_items_owner" ON "learning_plan_items";
CREATE POLICY "learning_plan_items_owner" ON "learning_plan_items" FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE "llm_calls" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "llm_calls" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "llm_calls_owner" ON "llm_calls";
CREATE POLICY "llm_calls_owner" ON "llm_calls" FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE "job_queue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_queue" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "job_queue_owner" ON "job_queue";
CREATE POLICY "job_queue_owner" ON "job_queue" FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE "raw_blobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "raw_blobs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "raw_blobs_owner" ON "raw_blobs";
CREATE POLICY "raw_blobs_owner" ON "raw_blobs" FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE "inbound_emails" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inbound_emails" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inbound_emails_owner" ON "inbound_emails";
CREATE POLICY "inbound_emails_owner" ON "inbound_emails" FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- JS-038: rechazos del webhook por el límite horario (migración 0012)
ALTER TABLE "inbound_rejections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inbound_rejections" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inbound_rejections_owner" ON "inbound_rejections";
CREATE POLICY "inbound_rejections_owner" ON "inbound_rejections" FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- JS-048: decisiones por dominio remitente del aviso de fuga del filtro
ALTER TABLE "inbound_sender_domains" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inbound_sender_domains" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inbound_sender_domains_owner" ON "inbound_sender_domains";
CREATE POLICY "inbound_sender_domains_owner" ON "inbound_sender_domains" FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE "job_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_sources" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "job_sources_via_job" ON "job_sources";
CREATE POLICY "job_sources_via_job" ON "job_sources" FOR ALL
  USING (EXISTS (SELECT 1 FROM jobs j WHERE j.id = "job_sources".job_id AND j.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM jobs j WHERE j.id = "job_sources".job_id AND j.user_id = auth.uid()));

ALTER TABLE "job_skills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_skills" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "job_skills_via_job" ON "job_skills";
CREATE POLICY "job_skills_via_job" ON "job_skills" FOR ALL
  USING (EXISTS (SELECT 1 FROM jobs j WHERE j.id = "job_skills".job_id AND j.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM jobs j WHERE j.id = "job_skills".job_id AND j.user_id = auth.uid()));

ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "companies_read" ON "companies";
CREATE POLICY "companies_read" ON "companies" FOR SELECT USING (true);
-- Catálogo global sin user_id: la ingesta manual desde la app (JS-023) necesita crear la empresa;
-- el nombre normalizado es único, así que insertar de más no rompe nada. UPDATE/DELETE siguen sin policy.
DROP POLICY IF EXISTS "companies_insert" ON "companies";
CREATE POLICY "companies_insert" ON "companies" FOR INSERT WITH CHECK (true);

ALTER TABLE "skills" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "skills_read" ON "skills";
CREATE POLICY "skills_read" ON "skills" FOR SELECT USING (true);

ALTER TABLE "learning_resources" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "learning_resources_read" ON "learning_resources";
CREATE POLICY "learning_resources_read" ON "learning_resources" FOR SELECT USING (true);

ALTER TABLE "model_routing" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "model_routing_read" ON "model_routing";
CREATE POLICY "model_routing_read" ON "model_routing" FOR SELECT USING (true);

-- Permisos al grupo authenticated (migración 0005); jobsearch_app es miembro y hereda.
-- Se repiten acá porque este archivo corre en cada db:migrate y cubre tablas nuevas.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
