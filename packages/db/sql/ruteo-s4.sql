-- Ruteo de modelos: Claude como principal y Gemini de respaldo. Mismos valores que
-- packages/db/seeds/model_routing.json. Toca solo provider, model, fallback_model, thinking_level y las
-- tarifas; temperature y max_tokens de cada tarea no se modifican (la guarda final lo verifica).
-- Corre con packages/db/src/run-sql-file.ts: primero --ensayo (termina en ROLLBACK), después sin él.
BEGIN;

-- Guarda previa: cada tarea existe y está en el estado de hoy (si no, se frena sin tocar nada).
DO $$
DECLARE
  esperado record;
  fila model_routing%ROWTYPE;
BEGIN
  FOR esperado IN
    SELECT * FROM (VALUES
      ('evaluate_job', 'anthropic', 'claude-sonnet-5-5'),
      ('extract_skills', 'google', 'gemini-3.5-flash'),
      ('parse_email_fallback', 'google', 'gemini-3.1-flash-lite'),
      ('cv_interview', 'google', 'gemini-3.5-flash'),
      ('extract_cv_profile', 'google', 'gemini-3.5-flash'),
      ('cv_write', 'google', 'gemini-3.5-flash'),
      ('cv_review', 'google', 'gemini-3.5-flash'),
      ('cv_coach_turn', 'google', 'gemini-3.5-flash'),
      ('extract_job_from_image', 'google', 'gemini-3.5-flash')
    ) AS v(task, provider, model)
  LOOP
    SELECT * INTO fila FROM model_routing WHERE task = esperado.task;
    IF NOT FOUND THEN
      RAISE EXCEPTION '% : no hay fila en model_routing', esperado.task;
    END IF;
    IF fila.provider IS DISTINCT FROM esperado.provider OR fila.model IS DISTINCT FROM esperado.model THEN
      RAISE EXCEPTION '% : hoy es %/%, se esperaba %/%; mirala antes de pisarla',
        esperado.task, fila.provider, fila.model, esperado.provider, esperado.model;
    END IF;
  END LOOP;
END $$;

-- evaluate_job ya es Sonnet 5.5 en producción: solo se le cambia el respaldo. Su thinking_level y su
-- max_tokens de producción se dejan como están (pueden diferir del seed: ver docs/beta/pasos-manuales-s4.md).
UPDATE model_routing SET fallback_model = 'gemini-3.5-flash',
  fallback_input_usd_per_mtok = 1.5::real, fallback_output_usd_per_mtok = 9::real, updated_at = now()
  WHERE task = 'evaluate_job';

-- Sonnet 5.5 de principal, respaldo Gemini 3.5 Flash
UPDATE model_routing SET provider = 'anthropic', model = 'claude-sonnet-5-5', fallback_model = 'gemini-3.5-flash',
  thinking_level = NULL, input_usd_per_mtok = 2::real, output_usd_per_mtok = 10::real,
  fallback_input_usd_per_mtok = 1.5::real, fallback_output_usd_per_mtok = 9::real, updated_at = now()
  WHERE task = 'cv_write';
UPDATE model_routing SET provider = 'anthropic', model = 'claude-sonnet-5-5', fallback_model = 'gemini-3.5-flash',
  thinking_level = NULL, input_usd_per_mtok = 2::real, output_usd_per_mtok = 10::real,
  fallback_input_usd_per_mtok = 1.5::real, fallback_output_usd_per_mtok = 9::real, updated_at = now()
  WHERE task = 'cv_review';
UPDATE model_routing SET provider = 'anthropic', model = 'claude-sonnet-5-5', fallback_model = 'gemini-3.5-flash',
  thinking_level = NULL, input_usd_per_mtok = 2::real, output_usd_per_mtok = 10::real,
  fallback_input_usd_per_mtok = 1.5::real, fallback_output_usd_per_mtok = 9::real, updated_at = now()
  WHERE task = 'cv_coach_turn';
UPDATE model_routing SET provider = 'anthropic', model = 'claude-sonnet-5-5', fallback_model = 'gemini-3.5-flash',
  thinking_level = NULL, input_usd_per_mtok = 2::real, output_usd_per_mtok = 10::real,
  fallback_input_usd_per_mtok = 1.5::real, fallback_output_usd_per_mtok = 9::real, updated_at = now()
  WHERE task = 'extract_job_from_image';

-- Haiku 4.5 de principal, respaldo Gemini
UPDATE model_routing SET provider = 'anthropic', model = 'claude-haiku-4-5', fallback_model = 'gemini-3.5-flash',
  thinking_level = NULL, input_usd_per_mtok = 1::real, output_usd_per_mtok = 5::real,
  fallback_input_usd_per_mtok = 1.5::real, fallback_output_usd_per_mtok = 9::real, updated_at = now()
  WHERE task = 'extract_skills';
UPDATE model_routing SET provider = 'anthropic', model = 'claude-haiku-4-5', fallback_model = 'gemini-3.5-flash',
  thinking_level = NULL, input_usd_per_mtok = 1::real, output_usd_per_mtok = 5::real,
  fallback_input_usd_per_mtok = 1.5::real, fallback_output_usd_per_mtok = 9::real, updated_at = now()
  WHERE task = 'cv_interview';
UPDATE model_routing SET provider = 'anthropic', model = 'claude-haiku-4-5', fallback_model = 'gemini-3.5-flash',
  thinking_level = NULL, input_usd_per_mtok = 1::real, output_usd_per_mtok = 5::real,
  fallback_input_usd_per_mtok = 1.5::real, fallback_output_usd_per_mtok = 9::real, updated_at = now()
  WHERE task = 'extract_cv_profile';
UPDATE model_routing SET provider = 'anthropic', model = 'claude-haiku-4-5', fallback_model = 'gemini-3.1-flash-lite',
  thinking_level = NULL, input_usd_per_mtok = 1::real, output_usd_per_mtok = 5::real,
  fallback_input_usd_per_mtok = 0.25::real, fallback_output_usd_per_mtok = 1.5::real, updated_at = now()
  WHERE task = 'parse_email_fallback';

-- Guarda final: cada tarea quedó exactamente como el seed.
DO $$
DECLARE
  esperado record;
  fallos text := '';
BEGIN
  FOR esperado IN
    SELECT * FROM (VALUES
      ('evaluate_job', 'claude-sonnet-5-5', 'gemini-3.5-flash', 2::real, 10::real, 1.5::real, 9::real),
      ('cv_write', 'claude-sonnet-5-5', 'gemini-3.5-flash', 2::real, 10::real, 1.5::real, 9::real),
      ('cv_review', 'claude-sonnet-5-5', 'gemini-3.5-flash', 2::real, 10::real, 1.5::real, 9::real),
      ('cv_coach_turn', 'claude-sonnet-5-5', 'gemini-3.5-flash', 2::real, 10::real, 1.5::real, 9::real),
      ('extract_job_from_image', 'claude-sonnet-5-5', 'gemini-3.5-flash', 2::real, 10::real, 1.5::real, 9::real),
      ('extract_skills', 'claude-haiku-4-5', 'gemini-3.5-flash', 1::real, 5::real, 1.5::real, 9::real),
      ('cv_interview', 'claude-haiku-4-5', 'gemini-3.5-flash', 1::real, 5::real, 1.5::real, 9::real),
      ('extract_cv_profile', 'claude-haiku-4-5', 'gemini-3.5-flash', 1::real, 5::real, 1.5::real, 9::real),
      ('parse_email_fallback', 'claude-haiku-4-5', 'gemini-3.1-flash-lite', 1::real, 5::real, 0.25::real, 1.5::real)
    ) AS v(task, model, fallback_model, in_usd, out_usd, fb_in_usd, fb_out_usd)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM model_routing
      WHERE task = esperado.task AND provider = 'anthropic'
        AND model = esperado.model AND fallback_model = esperado.fallback_model
        AND (thinking_level IS NULL OR esperado.task = 'evaluate_job')
        AND input_usd_per_mtok = esperado.in_usd AND output_usd_per_mtok = esperado.out_usd
        AND fallback_input_usd_per_mtok = esperado.fb_in_usd
        AND fallback_output_usd_per_mtok = esperado.fb_out_usd
    ) THEN
      fallos := fallos || ' ' || esperado.task;
    END IF;
  END LOOP;
  IF fallos <> '' THEN
    RAISE EXCEPTION 'filas que no quedaron como se esperaba:%', fallos;
  END IF;
  -- temperature y max_tokens no se tocan: siguen los valores del seed
  IF (SELECT count(*) FROM model_routing WHERE (task, temperature, max_tokens) IN (
        ('extract_skills', 0::real, 4096),
        ('parse_email_fallback', 0::real, 1024), ('cv_interview', 0::real, 1024),
        ('extract_cv_profile', 0::real, 4096), ('cv_write', 0.3::real, 3000),
        ('cv_review', 0::real, 2048), ('cv_coach_turn', 0::real, 1536),
        ('extract_job_from_image', 0::real, 4096))) <> 8 THEN
    RAISE EXCEPTION 'temperature o max_tokens distintos del seed: se frena para revisarlos';
  END IF;
END $$;

COMMIT;
