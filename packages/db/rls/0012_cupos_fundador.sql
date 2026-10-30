-- Cupos de fundador por carrera (C-13b), solo para admins (app_admins). Cuenta PERSONAS con plan
-- «fundador» vigente (plan_until null o posterior a now(), como effectivePlan en pipeline/plans.ts)
-- y las agrupa por su carrera principal: la primera de profiles.target_roles o, si la lista está
-- vacía, target_role. Mismo patrón que admin_beta_metrics (0009): SECURITY DEFINER, search_path
-- fijo, objetos calificados, REVOKE de PUBLIC y EXECUTE solo para authenticated. Idempotente.
--
-- Sin parámetros: quien llama no decide qué carreras son válidas. La lista de v_valid_roles es la de
-- ROLE_KEYS (pipeline/src/skills/self-assessment.ts) y se mantiene a mano; el test
-- packages/db/src/cupos-fundador-roles.test.ts rompe el CI si difieren. Una carrera que no esté ahí
-- (texto libre, clave vieja, vacía, «total», «sin_carrera», ninguna) se cuenta en «sin_carrera»; el
-- texto de un perfil nunca sale de la función. k-anonimato igual que en admin_beta_metrics: un grupo
-- con menos de 3 personas devuelve people = null. Además de las carreras vuelven «sin_carrera» (si
-- hay alguien) y «total». El total sigue la misma regla y además va en null si algún otro grupo
-- (carrera o sin_carrera) quedó oculto: así, total menos los grupos visibles no permite deducir el
-- tamaño de un grupo de menos de 3 en una sola consulta.
-- Riesgo aceptado (CF-2): comparar consultas en el tiempo (antes y después de un alta) sí podría
-- revelar un grupo chico. Lo ve solo un admin de confianza, mismo patrón que admin_beta_metrics.
--
-- profiles_definer_select (0009) deja al dueño de la función leer profiles con FORCE RLS.
DROP FUNCTION IF EXISTS public.admin_founder_counts(text[]);
DROP FUNCTION IF EXISTS public.admin_founder_counts();
CREATE FUNCTION public.admin_founder_counts()
RETURNS TABLE (
  role text,
  people integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  k CONSTANT integer := 3;
  v_valid_roles CONSTANT text[] := ARRAY[
    'frontend', 'backend', 'fullstack', 'qa', 'data_analyst', 'soporte_it', 'ai_engineer',
    'ux_ui', 'marketing_digital', 'rrhh_it', 'customer_success', 'ciberseguridad',
    'product_manager', 'product_owner', 'project_manager', 'product_marketing',
    'data_engineer', 'solutions_engineer', 'ventas_b2b', 'atencion_cliente',
    'finanzas_contabilidad', 'asistencia_operaciones', 'abogacia', 'administracion_empresas',
    'comunicacion', 'relaciones_internacionales'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_founder_counts: no autorizado';
  END IF;

  RETURN QUERY
  WITH founders AS (
    SELECT coalesce(p.target_roles[1], p.target_role) AS career
      FROM public.profiles p
     WHERE p.plan = 'fundador'
       AND (p.plan_until IS NULL OR p.plan_until > now())
  ),
  keyed AS (
    SELECT CASE
             WHEN f.career IS NOT NULL AND f.career = ANY (v_valid_roles) THEN f.career
             ELSE 'sin_carrera'
           END AS career
      FROM founders f
  ),
  grouped AS (
    SELECT kd.career AS g_role, count(*)::integer AS n FROM keyed kd GROUP BY kd.career
    UNION ALL
    SELECT 'total', count(*)::integer FROM keyed HAVING count(*) > 0
  )
  SELECT g.g_role,
         CASE
           WHEN g.g_role = 'total'
             THEN CASE WHEN g.n >= k
                        AND NOT EXISTS (SELECT 1 FROM grouped h WHERE h.g_role <> 'total' AND h.n < k)
                       THEN g.n END
           WHEN g.n >= k THEN g.n
         END
    FROM grouped g
   ORDER BY g.g_role;
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_founder_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_founder_counts() TO authenticated;
