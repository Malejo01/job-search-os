-- «Contanos qué pasó» (C-23, V4): beta_feedback. Idempotente: corre en cada db:migrate.
-- La persona inserta y lee SOLO lo suyo. Sin policy de UPDATE ni de DELETE para la app: un
-- comentario enviado no se edita ni se borra desde la app (se va con la cuenta, por cascade, o con
-- la purga de 180 días).
ALTER TABLE "beta_feedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "beta_feedback" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "beta_feedback_owner_select" ON "beta_feedback";
CREATE POLICY "beta_feedback_owner_select" ON "beta_feedback" FOR SELECT
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS "beta_feedback_owner_insert" ON "beta_feedback";
CREATE POLICY "beta_feedback_owner_insert" ON "beta_feedback" FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Sin policy de UPDATE ni de DELETE, con FORCE RLS esas sentencias de la app afectan 0 filas (el
-- test multiusuario lo comprueba).

-- Con FORCE RLS el dueño queda sujeto a las policies si su rol no tiene BYPASSRLS (Neon). Mismo
-- patrón que profiles_definer_select (0009): TO CURRENT_USER es el rol que aplica la migración, no
-- el de la app. La lectura es para admin_beta_feedback() (abajo) y el borrado para la purga de
-- retención (packages/adapters/src/retention/purge.ts), que corre con la conexión de servicio.
DROP POLICY IF EXISTS "beta_feedback_definer_select" ON "beta_feedback";
CREATE POLICY "beta_feedback_definer_select" ON "beta_feedback" FOR SELECT TO CURRENT_USER USING (true);
DROP POLICY IF EXISTS "beta_feedback_definer_delete" ON "beta_feedback";
CREATE POLICY "beta_feedback_definer_delete" ON "beta_feedback" FOR DELETE TO CURRENT_USER USING (true);

-- Lectura del admin (/settings/metricas): las últimas 50, sin email ni nombre. La persona sale como
-- un identificador seudónimo corto: los primeros 6 caracteres del sha256 del user_id. Mismo patrón que
-- admin_beta_metrics (0009): SECURITY DEFINER, search_path fijo, objetos calificados, REVOKE de
-- PUBLIC y EXECUTE solo para authenticated; solo quien está en app_admins.
DROP FUNCTION IF EXISTS public.admin_beta_feedback();
CREATE FUNCTION public.admin_beta_feedback()
RETURNS TABLE (
  created_at timestamptz,
  category text,
  path text,
  message text,
  person text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_beta_feedback: no autorizado';
  END IF;

  RETURN QUERY
  SELECT f.created_at, f.category, f.path, f.message,
         left(encode(sha256(convert_to(f.user_id::text, 'UTF8')), 'hex'), 6)
    FROM public.beta_feedback f
   ORDER BY f.created_at DESC, f.id DESC
   LIMIT 50;
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_beta_feedback() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_beta_feedback() TO authenticated;
