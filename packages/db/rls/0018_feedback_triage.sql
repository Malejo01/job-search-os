-- Triage del feedback de la beta (C8-17). Idempotente: corre en cada db:migrate.
--
-- El admin lee los comentarios con su carrera, el estado y las acciones del chip, y cambia el estado
-- (nuevo / visto / resuelto). Mismo patrón que admin_beta_feedback (0013): SECURITY DEFINER, search_path
-- fijo, objetos calificados, barrera app_admins, REVOKE de PUBLIC y EXECUTE solo para authenticated.
-- La persona sigue saliendo con su identificador seudónimo (6 caracteres del sha256 del user_id).
--
-- Con FORCE RLS el dueño queda sujeto a las policies: hace falta la de UPDATE para el rol que aplica la
-- migración (la app no tiene ninguna).
DROP POLICY IF EXISTS "beta_feedback_definer_update" ON "beta_feedback";
CREATE POLICY "beta_feedback_definer_update" ON "beta_feedback" FOR UPDATE TO CURRENT_USER
  USING (true) WITH CHECK (true);

DROP FUNCTION IF EXISTS public.admin_beta_feedback_triage(integer);
CREATE FUNCTION public.admin_beta_feedback_triage(p_limit integer DEFAULT 500)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  category text,
  path text,
  message text,
  person text,
  career text,
  status text,
  actions jsonb
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
  SELECT f.id, f.created_at, f.category, f.path, f.message,
         left(encode(sha256(convert_to(f.user_id::text, 'UTF8')), 'hex'), 6),
         p.target_role,
         f.status,
         CASE WHEN jsonb_typeof(f.context -> 'actions') = 'array' THEN f.context -> 'actions' ELSE '[]'::jsonb END
    FROM public.beta_feedback f
    LEFT JOIN public.profiles p ON p.user_id = f.user_id
   ORDER BY f.created_at DESC, f.id DESC
   LIMIT least(greatest(coalesce(p_limit, 500), 1), 500);
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_beta_feedback_triage(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_beta_feedback_triage(integer) TO authenticated;

DROP FUNCTION IF EXISTS public.admin_beta_feedback_set_status(uuid, text);
CREATE FUNCTION public.admin_beta_feedback_set_status(p_id uuid, p_status text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_beta_feedback: no autorizado';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('nuevo', 'visto', 'resuelto') THEN
    RAISE EXCEPTION 'admin_beta_feedback_set_status: estado inválido';
  END IF;
  UPDATE public.beta_feedback SET status = p_status, status_changed_at = now() WHERE id = p_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_beta_feedback_set_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_beta_feedback_set_status(uuid, text) TO authenticated;
