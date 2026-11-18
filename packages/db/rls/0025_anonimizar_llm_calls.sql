-- Gasto de una cuenta borrada. Idempotente: se aplica en cada pnpm db:migrate.
-- El costo sigue contando para los topes y las métricas, sin nada que identifique a la persona.
-- La policy de dueño no deja poner user_id en null, por eso va por una función que solo actúa sobre la
-- cuenta de la sesión. Las filas sin user_id no las ve la app: `user_id = auth.uid()` nunca da verdadero.
DROP POLICY IF EXISTS "llm_calls_definer_update" ON "llm_calls";
CREATE POLICY "llm_calls_definer_update" ON "llm_calls" FOR UPDATE TO CURRENT_USER
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.anonymize_llm_calls(p_user_id uuid) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_count integer;
BEGIN
  IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'anonymize_llm_calls: solo la cuenta propia';
  END IF;
  UPDATE public.llm_calls
     SET user_id = NULL, job_id = NULL, label = NULL, error = NULL
   WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$fn$;
REVOKE ALL ON FUNCTION public.anonymize_llm_calls(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.anonymize_llm_calls(uuid) TO authenticated;
