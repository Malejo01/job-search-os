-- Revisión de Academy desde la app (R26-01). Idempotente: corre en cada db:migrate.
--
-- Mismo patrón que 0054 y 0064: funciones SECURITY DEFINER con search_path fijo, objetos calificados, REVOKE de
-- PUBLIC y EXECUTE solo para authenticated. La barrera de quien revisa vive acá además de la app:
-- una fila en `app_admins` o el rol `tester` en `user_roles` para auth.uid().
--
--   1. `academy_reviews`: sin acceso directo de la app. Solo se agrega (no se edita ni se borra); el estado
--      vigente de una ficha es su fila más nueva.
--   2. `academy_approved_list()`: cualquier sesión. Devuelve solo (slug, huella) de las fichas cuya fila más
--      nueva es una aprobación; ni quién, ni cuándo, ni comentario. La app decide si la huella coincide con el
--      contenido de hoy (packages/pipeline/src/publicacion.ts).
--   3. `academy_review_add`, `academy_review_latest` y `academy_review_history`: solo quien revisa.

ALTER TABLE "academy_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "academy_reviews" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "academy_reviews_definer_select" ON "academy_reviews";
CREATE POLICY "academy_reviews_definer_select" ON "academy_reviews" FOR SELECT TO CURRENT_USER
  USING (true);
DROP POLICY IF EXISTS "academy_reviews_definer_insert" ON "academy_reviews";
CREATE POLICY "academy_reviews_definer_insert" ON "academy_reviews" FOR INSERT TO CURRENT_USER
  WITH CHECK (true);
REVOKE ALL ON "academy_reviews" FROM authenticated;

-- ─── Quién revisa ──────────────────────────────────────────────────────────────────────────────────────
-- ¿La sesión es admin (app_admins) o tester (user_roles)? Sin parámetros: solo responde por auth.uid().
DROP FUNCTION IF EXISTS public.can_review_content();
CREATE FUNCTION public.can_review_content()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.role = 'tester')
  )
$fn$;
REVOKE ALL ON FUNCTION public.can_review_content() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_review_content() TO authenticated;

-- ─── Lectura para cualquier sesión ─────────────────────────────────────────────────────────────────────
-- Las fichas aprobadas vigentes: la fila más nueva de cada slug, si es una aprobación.
DROP FUNCTION IF EXISTS public.academy_approved_list();
CREATE FUNCTION public.academy_approved_list()
RETURNS TABLE (slug text, content_hash text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT l.slug, l.content_hash
    FROM (
      SELECT DISTINCT ON (r.slug) r.slug, r.content_hash, r.status
        FROM public.academy_reviews r
       ORDER BY r.slug, r.created_at DESC, r.id DESC
    ) l
   WHERE l.status = 'aprobada' AND auth.uid() IS NOT NULL
$fn$;
REVOKE ALL ON FUNCTION public.academy_approved_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.academy_approved_list() TO authenticated;

-- ─── Solo quien revisa ─────────────────────────────────────────────────────────────────────────────────
-- Agrega una revisión. Devuelve 'ok', 'sin_cambio' (la fila más nueva ya dice lo mismo sobre la misma huella)
-- o 'invalido' (slug, huella o estado fuera de lo permitido, o «cambios» sin comentario).
DROP FUNCTION IF EXISTS public.academy_review_add(text, text, text, text);
CREATE FUNCTION public.academy_review_add(
  p_slug text, p_hash text, p_status text, p_comment text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_stored text;
  v_last record;
BEGIN
  IF NOT public.can_review_content() THEN
    RAISE EXCEPTION 'academy_review: no autorizado';
  END IF;
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR char_length(p_slug) > 80
     OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$'
     OR p_status IS NULL OR p_status NOT IN ('aprobada', 'cambios')
     OR (v_comment IS NOT NULL AND char_length(v_comment) > 500)
     OR (p_status = 'cambios' AND v_comment IS NULL) THEN
    RETURN 'invalido';
  END IF;
  -- Serializa a quienes revisan la misma ficha al mismo tiempo
  PERFORM pg_advisory_xact_lock(hashtextextended('academy_review:' || p_slug, 0));
  SELECT r.status, r.content_hash, r.comment INTO v_last
    FROM public.academy_reviews r
   WHERE r.slug = p_slug
   ORDER BY r.created_at DESC, r.id DESC
   LIMIT 1;
  -- Una aprobación no lleva comentario
  v_stored := CASE WHEN p_status = 'aprobada' THEN NULL ELSE v_comment END;
  IF FOUND AND v_last.status = p_status AND v_last.content_hash = p_hash
     AND v_last.comment IS NOT DISTINCT FROM v_stored THEN
    RETURN 'sin_cambio';
  END IF;
  INSERT INTO public.academy_reviews (user_id, slug, content_hash, status, comment, created_at)
  VALUES (auth.uid(), p_slug, p_hash, p_status, v_stored, clock_timestamp());
  RETURN 'ok';
END
$fn$;
REVOKE ALL ON FUNCTION public.academy_review_add(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.academy_review_add(text, text, text, text) TO authenticated;

-- Lo último que se dijo de cada ficha (con comentario y quién), para la pantalla de revisión.
DROP FUNCTION IF EXISTS public.academy_review_latest();
CREATE FUNCTION public.academy_review_latest()
RETURNS TABLE (slug text, content_hash text, status text, comment text, reviewer_email text, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT public.can_review_content() THEN
    RAISE EXCEPTION 'academy_review: no autorizado';
  END IF;
  RETURN QUERY
    SELECT l.slug, l.content_hash, l.status, l.comment, u.email, l.created_at
      FROM (
        SELECT DISTINCT ON (r.slug) r.slug, r.content_hash, r.status, r.comment, r.user_id, r.created_at
          FROM public.academy_reviews r
         ORDER BY r.slug, r.created_at DESC, r.id DESC
      ) l
      LEFT JOIN public.users u ON u.id = l.user_id
     ORDER BY l.slug;
END
$fn$;
REVOKE ALL ON FUNCTION public.academy_review_latest() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.academy_review_latest() TO authenticated;

-- Historial de una ficha (o de todas con NULL), los más nuevos primero. Tope de 100.
DROP FUNCTION IF EXISTS public.academy_review_history(text, integer);
CREATE FUNCTION public.academy_review_history(p_slug text DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS TABLE (slug text, content_hash text, status text, comment text, reviewer_email text, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT public.can_review_content() THEN
    RAISE EXCEPTION 'academy_review: no autorizado';
  END IF;
  RETURN QUERY
    SELECT r.slug, r.content_hash, r.status, r.comment, u.email, r.created_at
      FROM public.academy_reviews r
      LEFT JOIN public.users u ON u.id = r.user_id
     WHERE p_slug IS NULL OR r.slug = p_slug
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT least(greatest(coalesce(p_limit, 50), 1), 100);
END
$fn$;
REVOKE ALL ON FUNCTION public.academy_review_history(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.academy_review_history(text, integer) TO authenticated;
