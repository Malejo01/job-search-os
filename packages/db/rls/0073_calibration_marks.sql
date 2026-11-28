-- Exportación de la calibración de la evaluación nueva (R31-10), solo para admins (app_admins). Una fila por
-- evaluación con `evaluate_job@v1.5+` que alguien marcó («¿Te sirve esta evaluación?», su motivo o «Proponer otro
-- puntaje»). Mismo patrón que admin_feedback_reports (0069) y admin_usage_by_career (0057): SECURITY DEFINER,
-- search_path fijo, objetos calificados, barrera app_admins, REVOKE de PUBLIC y EXECUTE solo para authenticated.
-- Idempotente. No crea tablas ni policies: jobs y evaluations ya tienen su `*_definer_select` (rls/0009).
--
-- SIN DATOS PERSONALES: no sale email, nombre, user_id ni nada del perfil. La persona es el identificador seudónimo
-- de 6 caracteres del sha256 de su user_id (igual que los informes) y la oferta, una referencia de 8 caracteres del
-- sha256 de su id (no reversible). El título y la empresa salen SOLO si el aviso es del pool (jobs.public_job_id no
-- es null: es un aviso público); una oferta que la persona cargó sale con título y empresa en null. El motivo es el
-- texto corto (hasta 140 caracteres) que escribió quien revisó: la pantalla le pide no incluir datos personales.
-- Las sin marcar no salen. Sin parámetro de persona: no se puede pedir lo de una persona en particular.

DROP FUNCTION IF EXISTS public.admin_calibration_marks(integer);
CREATE FUNCTION public.admin_calibration_marks(p_limit integer DEFAULT 500)
RETURNS TABLE (
  marked_at date,
  person text,
  job_ref text,
  title text,
  company text,
  prompt_version text,
  discipline text,
  modality text,
  english text,
  had_full_jd boolean,
  score real,
  accion text,
  blockers integer,
  verdict text,
  note text,
  human_score real
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_calibration_marks: no autorizado';
  END IF;
  RETURN QUERY
  SELECT (coalesce(e.human_verdict_at, e.created_at) AT TIME ZONE 'America/Argentina/Buenos_Aires')::date,
         left(encode(sha256(convert_to(e.user_id::text, 'UTF8')), 'hex'), 6),
         left(encode(sha256(convert_to(e.job_id::text, 'UTF8')), 'hex'), 8),
         CASE WHEN j.public_job_id IS NOT NULL THEN j.title END,
         CASE WHEN j.public_job_id IS NOT NULL THEN j.company_raw END,
         e.prompt_version,
         e.discipline::text,
         e.modality::text,
         e.english_required::text,
         e.had_full_jd,
         e.score,
         e.accion::text,
         coalesce(array_length(e.bloqueadores_duros, 1), 0),
         e.human_verdict::text,
         e.human_note,
         e.human_score
    FROM public.evaluations e
    JOIN public.jobs j ON j.id = e.job_id
   WHERE e.prompt_version ~ '^evaluate_job@v(1\.([5-9]|[1-9][0-9]+)|[2-9]|[1-9][0-9]+)'
     AND (e.human_verdict IS NOT NULL OR e.human_score IS NOT NULL OR e.human_note IS NOT NULL)
   ORDER BY coalesce(e.human_verdict_at, e.created_at) DESC, e.id
   LIMIT least(greatest(coalesce(p_limit, 500), 1), 2000);
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_calibration_marks(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_calibration_marks(integer) TO authenticated;
