-- Ficha del aviso (R31-01, ADR-048): job_cards. Idempotente: corre en cada db:migrate.
--
-- Una fila por descripción (clave: jd_hash). Sale solo del texto del aviso y es la misma para todas las personas,
-- por eso la tabla NO tiene user_id: no guarda nada que diga quién la pidió.
--
-- Lectura de la app: una persona lee una ficha solo si su hash coincide con una oferta SUYA (jobs, que ya tiene su
-- propia RLS por user_id) o con un aviso del pool (public_jobs, de lectura abierta). Sin coincidencia, 0 filas.
-- Escritura: la app (jobsearch_app) no tiene permiso ni policy de INSERT/UPDATE/DELETE. La escribe el proceso que
-- genera la ficha con la conexión de servicio (el rol dueño, purpose `service`), por las policies *_service_* (TO
-- CURRENT_USER: el rol que aplica la migración). Con FORCE RLS el dueño también queda sujeto a las policies.
--
-- Permisos: 0030 retira los de toda tabla sin RLS en el momento en que corre y esta se activa acá, después; por eso
-- se dan explícitos (como en 0069).

ALTER TABLE "job_cards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_cards" FORCE ROW LEVEL SECURITY;
GRANT SELECT ON "job_cards" TO authenticated;

DROP POLICY IF EXISTS "job_cards_owner_or_pool_select" ON "job_cards";
CREATE POLICY "job_cards_owner_or_pool_select" ON "job_cards" FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.jd_hash = job_cards.jd_hash AND j.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.public_jobs pj
       WHERE pj.jd_hash = job_cards.jd_hash
    )
  );

DROP POLICY IF EXISTS "job_cards_service_select" ON "job_cards";
CREATE POLICY "job_cards_service_select" ON "job_cards" FOR SELECT TO CURRENT_USER USING (true);

DROP POLICY IF EXISTS "job_cards_service_insert" ON "job_cards";
CREATE POLICY "job_cards_service_insert" ON "job_cards" FOR INSERT TO CURRENT_USER WITH CHECK (true);

DROP POLICY IF EXISTS "job_cards_service_update" ON "job_cards";
CREATE POLICY "job_cards_service_update" ON "job_cards" FOR UPDATE TO CURRENT_USER
  USING (true) WITH CHECK (true);
