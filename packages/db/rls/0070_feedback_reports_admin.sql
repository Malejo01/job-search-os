-- Funciones del admin sobre los informes de revisión y cupos de los adjuntos (R29-04, R29-05, ADR-047).
-- Idempotente: corre en cada db:migrate. Las tablas y sus policies están en rls/0069.
--
-- Mismo patrón que rls/0013 y rls/0018: SECURITY DEFINER, search_path fijo, objetos calificados, barrera
-- app_admins (menos la de cupo, que no devuelve filas), REVOKE de PUBLIC y EXECUTE solo para `authenticated`.
-- Los borradores nunca se ven ni se cambian desde acá: el admin trabaja sobre lo que la persona envió.

-- Cambia el estado de un ítem (nuevo / visto / resuelto) y deriva el del informe:
--   todos los ítems resueltos -> resuelto; alguno visto o resuelto -> visto; ninguno -> enviado.
-- Devuelve false si el ítem no existe o su informe todavía es borrador.
DROP FUNCTION IF EXISTS public.admin_feedback_item_set_status(uuid, text);
CREATE FUNCTION public.admin_feedback_item_set_status(p_item_id uuid, p_status text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_report uuid;
  v_total integer;
  v_new integer;
  v_resolved integer;
  v_status text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_feedback_item_set_status: no autorizado';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('nuevo', 'visto', 'resuelto') THEN
    RAISE EXCEPTION 'admin_feedback_item_set_status: estado inválido';
  END IF;
  SELECT i.report_id INTO v_report
    FROM public.feedback_items i
    JOIN public.feedback_reports r ON r.id = i.report_id
   WHERE i.id = p_item_id AND r.status <> 'borrador';
  IF v_report IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.feedback_items
     SET status = p_status, status_changed_at = now(), updated_at = now()
   WHERE id = p_item_id AND status IS DISTINCT FROM p_status;
  SELECT count(*)::integer,
         count(*) FILTER (WHERE status = 'nuevo')::integer,
         count(*) FILTER (WHERE status = 'resuelto')::integer
    INTO v_total, v_new, v_resolved
    FROM public.feedback_items WHERE report_id = v_report;
  v_status := CASE
    WHEN v_total > 0 AND v_resolved = v_total THEN 'resuelto'
    WHEN v_new < v_total THEN 'visto'
    ELSE 'enviado'
  END;
  UPDATE public.feedback_reports
     SET status = v_status, status_changed_at = now(), updated_at = now()
   WHERE id = v_report AND status <> 'borrador' AND status IS DISTINCT FROM v_status;
  RETURN true;
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_feedback_item_set_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_feedback_item_set_status(uuid, text) TO authenticated;

-- Un adjunto de un informe ya enviado, con sus bytes, para la descarga del admin (`GET /api/feedback-files/[id]`).
-- Sin filas si no existe, si el informe es borrador, si el adjunto se limpió o si falta el archivo. No devuelve la
-- ref ni el dueño.
DROP FUNCTION IF EXISTS public.admin_feedback_attachment(uuid);
CREATE FUNCTION public.admin_feedback_attachment(p_id uuid)
RETURNS TABLE (
  id uuid,
  kind text,
  mime text,
  original_name text,
  bytes integer,
  data bytea
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_feedback_attachment: no autorizado';
  END IF;
  RETURN QUERY
  SELECT a.id, a.kind, a.mime, a.original_name, a.bytes, b.data
    FROM public.feedback_attachments a
    JOIN public.feedback_items i ON i.id = a.item_id
    JOIN public.feedback_reports r ON r.id = i.report_id
    JOIN public.blob_files b ON a.blob_ref = 'pgb:' || b.id::text
   WHERE a.id = p_id AND a.deleted_at IS NULL AND r.status <> 'borrador';
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_feedback_attachment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_feedback_attachment(uuid) TO authenticated;

-- Bytes guardados por todas las personas: la app no ve las filas de otras (RLS), así que el tope global de
-- adjuntos (400 MB por defecto) lo mide esta función. Devuelve solo un número, sin filas ni dueños.
DROP FUNCTION IF EXISTS public.feedback_files_global_bytes();
CREATE FUNCTION public.feedback_files_global_bytes()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT coalesce(sum(b.bytes), 0)::bigint FROM public.blob_files b;
$fn$;
REVOKE ALL ON FUNCTION public.feedback_files_global_bytes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.feedback_files_global_bytes() TO authenticated;

-- Limpieza de adjuntos de lo ya resuelto (R29-09). Borra el archivo (`blob_files`) y marca el adjunto como
-- borrado (`deleted_at`, `blob_ref = null`) en la misma transacción. El texto del ítem no se toca nunca.
--   · Solo adjuntos vivos de ítems en `resuelto`, de un informe que NO es borrador y con `status_changed_at`
--     de hace `p_days` días o más. Lo `nuevo` o `visto` y los borradores nunca entran.
--   · `p_item_id`: borra solo los de ese ítem (si está resuelto) sin esperar los días (p_days puede ser 0).
--   · `p_dry_run`: no borra; devuelve cuántos archivos y bytes borraría (para la confirmación del admin).
--   · Quién puede correrla: un admin (app_admins) o una conexión de servicio, que no es miembro de
--     `authenticated` (el cron). La app con una persona común o sin sesión recibe «no autorizado».
--   · Cada persona afectada deja un `admin_events` ('adjuntos_purga' o 'adjuntos_purga_item').
DROP FUNCTION IF EXISTS public.purge_resolved_attachments(integer, uuid, boolean);
CREATE FUNCTION public.purge_resolved_attachments(
  p_days integer,
  p_item_id uuid DEFAULT NULL,
  p_dry_run boolean DEFAULT false
)
RETURNS TABLE (files_deleted integer, bytes_freed bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_admin boolean;
  v_files integer := 0;
  v_bytes bigint := 0;
  v_ids uuid[];
  v_refs text[];
  v_users uuid[];
BEGIN
  v_admin := EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid());
  -- Conexión de servicio (el cron): sin usuario de la app y que no sea el rol de la app
  IF NOT v_admin AND NOT (auth.uid() IS NULL AND session_user <> 'jobsearch_app') THEN
    RAISE EXCEPTION 'purge_resolved_attachments: no autorizado';
  END IF;
  IF p_days IS NULL OR p_days < 0 OR (p_days = 0 AND p_item_id IS NULL) THEN
    RAISE EXCEPTION 'purge_resolved_attachments: días inválidos';
  END IF;

  SELECT array_agg(s.att_id), array_agg(s.blob_ref), array_agg(DISTINCT s.user_id),
         count(*)::integer, coalesce(sum(s.att_bytes), 0)::bigint
    INTO v_ids, v_refs, v_users, v_files, v_bytes
    FROM (
  SELECT a.id AS att_id, a.user_id, a.bytes AS att_bytes, a.blob_ref
    FROM public.feedback_attachments a
    JOIN public.feedback_items i ON i.id = a.item_id
    JOIN public.feedback_reports r ON r.id = i.report_id
   WHERE a.deleted_at IS NULL
     AND a.blob_ref IS NOT NULL
     AND i.status = 'resuelto'
     AND r.status <> 'borrador'
     AND i.status_changed_at IS NOT NULL
     AND i.status_changed_at <= now() - make_interval(days => p_days)
     AND (p_item_id IS NULL OR i.id = p_item_id)
    ) s;

  IF NOT p_dry_run AND v_files > 0 THEN
    DELETE FROM public.blob_files b WHERE 'pgb:' || b.id::text = ANY (v_refs);
    UPDATE public.feedback_attachments a
       SET deleted_at = now(), blob_ref = NULL
     WHERE a.id = ANY (v_ids);
    INSERT INTO public.admin_events (user_id, admin_id, action)
    SELECT u, auth.uid(), CASE WHEN p_item_id IS NULL THEN 'adjuntos_purga' ELSE 'adjuntos_purga_item' END
      FROM unnest(v_users) AS u;
  END IF;
  RETURN QUERY SELECT v_files, v_bytes;
END
$fn$;
REVOKE ALL ON FUNCTION public.purge_resolved_attachments(integer, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_resolved_attachments(integer, uuid, boolean) TO authenticated;

-- Los adjuntos ya borrados de un informe enviado (nombre, tamaño y fecha), para mostrar «adjunto borrado el …» en
-- lugar de la captura. Solo admins.
DROP FUNCTION IF EXISTS public.admin_feedback_deleted_attachments(uuid);
CREATE FUNCTION public.admin_feedback_deleted_attachments(p_report_id uuid)
RETURNS TABLE (item_id uuid, attachment_name text, attachment_bytes integer, deleted_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_feedback_deleted_attachments: no autorizado';
  END IF;
  RETURN QUERY
  SELECT i.id, a.original_name, a.bytes, a.deleted_at
    FROM public.feedback_attachments a
    JOIN public.feedback_items i ON i.id = a.item_id
    JOIN public.feedback_reports r ON r.id = i.report_id
   WHERE r.id = p_report_id AND r.status <> 'borrador' AND a.deleted_at IS NOT NULL
   ORDER BY i.position, a.deleted_at, a.id;
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_feedback_deleted_attachments(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_feedback_deleted_attachments(uuid) TO authenticated;
