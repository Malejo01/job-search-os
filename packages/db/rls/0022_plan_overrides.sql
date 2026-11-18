-- Precio especial por persona (ADR-040). Idempotente: corre en cada db:migrate.
--
-- `plan_overrides` guarda la marca `becado` o `tester_50` de una persona. Va en una tabla propia y no en
-- `profiles` porque la persona puede actualizar su propia fila de `profiles`: no puede poder darse un
-- descuento a sí misma. Acá:
--   * cada persona LEE solo su fila (para mostrarle su «Tu plan»);
--   * ninguna persona inserta, actualiza ni borra: con FORCE y sin policy de escritura para los roles de la
--     app, un INSERT falla por RLS y un UPDATE o DELETE no alcanza ninguna fila (como `beta_feedback`);
--   * el admin escribe solo por `admin_plan_override_set`, SECURITY DEFINER, con la barrera app_admins y el
--     mismo patrón que `admin_beta_feedback_set_status` (0018): search_path fijo, objetos calificados,
--     REVOKE de PUBLIC y EXECUTE solo para authenticated.
-- Al borrar la cuenta la fila cae por ON DELETE CASCADE.
ALTER TABLE "plan_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plan_overrides" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plan_overrides_owner_select" ON "plan_overrides";
CREATE POLICY "plan_overrides_owner_select" ON "plan_overrides" FOR SELECT
  USING (user_id = auth.uid());

-- Con FORCE RLS el dueño queda sujeto a las policies si su rol no tiene BYPASSRLS (Neon). TO CURRENT_USER
-- es el rol que aplica la migración, dueño de la tabla y de las funciones; el rol de la app no queda
-- alcanzado. Las usan las funciones de abajo y el cron de avisos (que corre como dueño).
DROP POLICY IF EXISTS "plan_overrides_definer_select" ON "plan_overrides";
CREATE POLICY "plan_overrides_definer_select" ON "plan_overrides" FOR SELECT TO CURRENT_USER
  USING (true);
DROP POLICY IF EXISTS "plan_overrides_definer_insert" ON "plan_overrides";
CREATE POLICY "plan_overrides_definer_insert" ON "plan_overrides" FOR INSERT TO CURRENT_USER
  WITH CHECK (true);
DROP POLICY IF EXISTS "plan_overrides_definer_update" ON "plan_overrides";
CREATE POLICY "plan_overrides_definer_update" ON "plan_overrides" FOR UPDATE TO CURRENT_USER
  USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "plan_overrides_definer_delete" ON "plan_overrides";
CREATE POLICY "plan_overrides_definer_delete" ON "plan_overrides" FOR DELETE TO CURRENT_USER
  USING (true);

-- Pone, cambia o saca la marca de una persona por su email. p_override null = sacarla.
-- Devuelve false si no existe esa persona (el código lo explica); la base solo acota los valores.
DROP FUNCTION IF EXISTS public.admin_plan_override_set(text, text);
CREATE FUNCTION public.admin_plan_override_set(p_email text, p_override text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_user uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_plan_override: no autorizado';
  END IF;
  IF p_override IS NOT NULL AND p_override NOT IN ('becado', 'tester_50') THEN
    RAISE EXCEPTION 'admin_plan_override: marca inválida';
  END IF;
  SELECT u.id INTO v_user FROM public.users u WHERE u.email = lower(btrim(p_email));
  IF v_user IS NULL THEN
    RETURN false;
  END IF;
  IF p_override IS NULL THEN
    DELETE FROM public.plan_overrides o WHERE o.user_id = v_user;
  ELSE
    INSERT INTO public.plan_overrides (user_id, override) VALUES (v_user, p_override)
    ON CONFLICT (user_id) DO UPDATE SET override = EXCLUDED.override;
  END IF;
  RETURN true;
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_plan_override_set(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_plan_override_set(text, text) TO authenticated;

-- Quién tiene una marca, para el panel. Tope de 200, las más nuevas primero.
DROP FUNCTION IF EXISTS public.admin_plan_override_list(integer);
CREATE FUNCTION public.admin_plan_override_list(p_limit integer DEFAULT 200)
RETURNS TABLE (
  email text,
  override text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_plan_override: no autorizado';
  END IF;
  RETURN QUERY
    SELECT u.email, o.override, o.created_at
      FROM public.plan_overrides o
      JOIN public.users u ON u.id = o.user_id
     ORDER BY o.created_at DESC, u.email
     LIMIT least(greatest(coalesce(p_limit, 200), 1), 200);
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_plan_override_list(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_plan_override_list(integer) TO authenticated;
