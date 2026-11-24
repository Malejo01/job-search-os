-- Revisión de los textos del rediseño desde la app (R26-02). Idempotente: corre en cada db:migrate.
--
-- Mismo patrón que 0065 (usa `public.can_review_content()`, que define ese archivo y corre antes): funciones
-- SECURITY DEFINER con search_path fijo, objetos calificados, REVOKE de PUBLIC y EXECUTE solo para
-- authenticated. Todo es solo para quien revisa (admin o tester): no hay lectura abierta, porque ninguna
-- pantalla de la gente común depende de esta tabla (la propuesta NO cambia la app: la pasa al código quien administra).
--
--   1. `text_reviews`: sin acceso directo de la app. Solo se agrega; el estado vigente de un texto es su fila
--      más nueva (aprobó ese texto, o propuso otro).
--   2. `text_review_add`, `text_review_latest` y `text_review_history`: solo quien revisa.

ALTER TABLE "text_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "text_reviews" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "text_reviews_definer_select" ON "text_reviews";
CREATE POLICY "text_reviews_definer_select" ON "text_reviews" FOR SELECT TO CURRENT_USER
  USING (true);
DROP POLICY IF EXISTS "text_reviews_definer_insert" ON "text_reviews";
CREATE POLICY "text_reviews_definer_insert" ON "text_reviews" FOR INSERT TO CURRENT_USER
  WITH CHECK (true);
REVOKE ALL ON "text_reviews" FROM authenticated;

-- Agrega una revisión. Devuelve 'ok', 'sin_cambio' (la fila más nueva ya dice lo mismo) o 'invalido' (clave,
-- huella o estado fuera de lo permitido, o «propuesta» sin texto).
DROP FUNCTION IF EXISTS public.text_review_add(text, text, text, text);
CREATE FUNCTION public.text_review_add(
  p_key text, p_hash text, p_status text, p_proposal text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_proposal text := nullif(btrim(coalesce(p_proposal, '')), '');
  v_stored text;
  v_last record;
BEGIN
  IF NOT public.can_review_content() THEN
    RAISE EXCEPTION 'text_review: no autorizado';
  END IF;
  IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_.-]+$' OR char_length(p_key) > 120
     OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$'
     OR p_status IS NULL OR p_status NOT IN ('aprobada', 'propuesta')
     OR (v_proposal IS NOT NULL AND char_length(v_proposal) > 1000)
     OR (p_status = 'propuesta' AND v_proposal IS NULL) THEN
    RETURN 'invalido';
  END IF;
  -- Una aprobación no lleva texto propuesto
  v_stored := CASE WHEN p_status = 'aprobada' THEN NULL ELSE v_proposal END;
  -- Serializa a quienes revisan el mismo texto al mismo tiempo
  PERFORM pg_advisory_xact_lock(hashtextextended('text_review:' || p_key, 0));
  SELECT r.status, r.default_hash, r.proposal INTO v_last
    FROM public.text_reviews r
   WHERE r.text_key = p_key
   ORDER BY r.created_at DESC, r.id DESC
   LIMIT 1;
  IF FOUND AND v_last.status = p_status AND v_last.default_hash = p_hash
     AND v_last.proposal IS NOT DISTINCT FROM v_stored THEN
    RETURN 'sin_cambio';
  END IF;
  INSERT INTO public.text_reviews (user_id, text_key, default_hash, status, proposal, created_at)
  VALUES (auth.uid(), p_key, p_hash, p_status, v_stored, clock_timestamp());
  RETURN 'ok';
END
$fn$;
REVOKE ALL ON FUNCTION public.text_review_add(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.text_review_add(text, text, text, text) TO authenticated;

-- Lo último que se dijo de cada texto (con la propuesta y quién), para las pantallas de revisión y para contar
-- los aprobados de la checklist de apertura.
DROP FUNCTION IF EXISTS public.text_review_latest();
CREATE FUNCTION public.text_review_latest()
RETURNS TABLE (text_key text, default_hash text, status text, proposal text, reviewer_email text, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT public.can_review_content() THEN
    RAISE EXCEPTION 'text_review: no autorizado';
  END IF;
  RETURN QUERY
    SELECT l.text_key, l.default_hash, l.status, l.proposal, u.email, l.created_at
      FROM (
        SELECT DISTINCT ON (r.text_key) r.text_key, r.default_hash, r.status, r.proposal, r.user_id, r.created_at
          FROM public.text_reviews r
         ORDER BY r.text_key, r.created_at DESC, r.id DESC
      ) l
      LEFT JOIN public.users u ON u.id = l.user_id
     ORDER BY l.text_key;
END
$fn$;
REVOKE ALL ON FUNCTION public.text_review_latest() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.text_review_latest() TO authenticated;

-- Historial de un texto (o de todos con NULL), los más nuevos primero. Tope de 100.
DROP FUNCTION IF EXISTS public.text_review_history(text, integer);
CREATE FUNCTION public.text_review_history(p_key text DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS TABLE (text_key text, default_hash text, status text, proposal text, reviewer_email text, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT public.can_review_content() THEN
    RAISE EXCEPTION 'text_review: no autorizado';
  END IF;
  RETURN QUERY
    SELECT r.text_key, r.default_hash, r.status, r.proposal, u.email, r.created_at
      FROM public.text_reviews r
      LEFT JOIN public.users u ON u.id = r.user_id
     WHERE p_key IS NULL OR r.text_key = p_key
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT least(greatest(coalesce(p_limit, 50), 1), 100);
END
$fn$;
REVOKE ALL ON FUNCTION public.text_review_history(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.text_review_history(text, integer) TO authenticated;
