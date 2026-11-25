-- «Mi informe de revisión» (R29-02, ADR-047): feedback_reports, feedback_items, feedback_attachments y blob_files.
-- Idempotente: corre en cada db:migrate.
--
-- La persona ve y arma SOLO lo suyo. Mientras el informe es borrador edita sus ítems y adjuntos; al enviarlo
-- (borrador -> enviado) queda como se mandó: la app no puede cambiarlo ni borrarlo, ni poner ella misma los
-- estados `visto` o `resuelto`. Esos los cambia el admin por funciones SECURITY DEFINER (rls/0070).
-- Con FORCE RLS el dueño también queda sujeto a las policies: las `*_definer_*` (TO CURRENT_USER, el rol que
-- aplica la migración y dueño de las funciones) son para las funciones admin_* y no están abiertas a la app.

-- Permisos: 0030 retira los de toda tabla sin RLS en el momento en que corre y estas tablas se activan acá, después;
-- por eso se dan explícitos (como en 0045/0053). Adjuntos y archivos no tienen policy de UPDATE para la app: con el
-- permiso pero sin policy, un UPDATE afecta 0 filas (lo comprueban feedback-report y multiusuario).
-- feedback_reports -----------------------------------------------------------------------------------------
ALTER TABLE "feedback_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feedback_reports" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "feedback_reports" TO authenticated;

DROP POLICY IF EXISTS "feedback_reports_owner_select" ON "feedback_reports";
CREATE POLICY "feedback_reports_owner_select" ON "feedback_reports" FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "feedback_reports_owner_insert" ON "feedback_reports";
CREATE POLICY "feedback_reports_owner_insert" ON "feedback_reports" FOR INSERT
  WITH CHECK (user_id = auth.uid() AND status = 'borrador');

-- Sale de borrador solo hacia `enviado` (el envío); nunca hacia visto/resuelto
DROP POLICY IF EXISTS "feedback_reports_owner_update" ON "feedback_reports";
CREATE POLICY "feedback_reports_owner_update" ON "feedback_reports" FOR UPDATE
  USING (user_id = auth.uid() AND status = 'borrador')
  WITH CHECK (user_id = auth.uid() AND status IN ('borrador', 'enviado'));

DROP POLICY IF EXISTS "feedback_reports_owner_delete" ON "feedback_reports";
CREATE POLICY "feedback_reports_owner_delete" ON "feedback_reports" FOR DELETE
  USING (user_id = auth.uid() AND status = 'borrador');

DROP POLICY IF EXISTS "feedback_reports_definer_select" ON "feedback_reports";
CREATE POLICY "feedback_reports_definer_select" ON "feedback_reports" FOR SELECT TO CURRENT_USER USING (true);
DROP POLICY IF EXISTS "feedback_reports_definer_update" ON "feedback_reports";
CREATE POLICY "feedback_reports_definer_update" ON "feedback_reports" FOR UPDATE TO CURRENT_USER
  USING (true) WITH CHECK (true);

-- feedback_items -------------------------------------------------------------------------------------------
ALTER TABLE "feedback_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feedback_items" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "feedback_items" TO authenticated;

DROP POLICY IF EXISTS "feedback_items_owner_select" ON "feedback_items";
CREATE POLICY "feedback_items_owner_select" ON "feedback_items" FOR SELECT
  USING (user_id = auth.uid());

-- Solo en un borrador propio, y siempre como `nuevo`
DROP POLICY IF EXISTS "feedback_items_owner_insert" ON "feedback_items";
CREATE POLICY "feedback_items_owner_insert" ON "feedback_items" FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'nuevo'
    AND EXISTS (
      SELECT 1 FROM public.feedback_reports r
       WHERE r.id = report_id AND r.user_id = auth.uid() AND r.status = 'borrador'
    )
  );

DROP POLICY IF EXISTS "feedback_items_owner_update" ON "feedback_items";
CREATE POLICY "feedback_items_owner_update" ON "feedback_items" FOR UPDATE
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.feedback_reports r
       WHERE r.id = report_id AND r.user_id = auth.uid() AND r.status = 'borrador'
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'nuevo'
    AND EXISTS (
      SELECT 1 FROM public.feedback_reports r
       WHERE r.id = report_id AND r.user_id = auth.uid() AND r.status = 'borrador'
    )
  );

DROP POLICY IF EXISTS "feedback_items_owner_delete" ON "feedback_items";
CREATE POLICY "feedback_items_owner_delete" ON "feedback_items" FOR DELETE
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.feedback_reports r
       WHERE r.id = report_id AND r.user_id = auth.uid() AND r.status = 'borrador'
    )
  );

DROP POLICY IF EXISTS "feedback_items_definer_select" ON "feedback_items";
CREATE POLICY "feedback_items_definer_select" ON "feedback_items" FOR SELECT TO CURRENT_USER USING (true);
DROP POLICY IF EXISTS "feedback_items_definer_update" ON "feedback_items";
CREATE POLICY "feedback_items_definer_update" ON "feedback_items" FOR UPDATE TO CURRENT_USER
  USING (true) WITH CHECK (true);

-- feedback_attachments -------------------------------------------------------------------------------------
ALTER TABLE "feedback_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feedback_attachments" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "feedback_attachments" TO authenticated;

DROP POLICY IF EXISTS "feedback_attachments_owner_select" ON "feedback_attachments";
CREATE POLICY "feedback_attachments_owner_select" ON "feedback_attachments" FOR SELECT
  USING (user_id = auth.uid());

-- Solo sobre un ítem propio de un borrador propio
DROP POLICY IF EXISTS "feedback_attachments_owner_insert" ON "feedback_attachments";
CREATE POLICY "feedback_attachments_owner_insert" ON "feedback_attachments" FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.feedback_items i
        JOIN public.feedback_reports r ON r.id = i.report_id
       WHERE i.id = item_id AND i.user_id = auth.uid() AND r.user_id = auth.uid() AND r.status = 'borrador'
    )
  );

DROP POLICY IF EXISTS "feedback_attachments_owner_delete" ON "feedback_attachments";
CREATE POLICY "feedback_attachments_owner_delete" ON "feedback_attachments" FOR DELETE
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.feedback_items i
        JOIN public.feedback_reports r ON r.id = i.report_id
       WHERE i.id = item_id AND i.user_id = auth.uid() AND r.user_id = auth.uid() AND r.status = 'borrador'
    )
  );

-- Sin UPDATE para la app: el borrado lógico (`deleted_at`, `blob_ref = null`) lo hace una función definer (R29-09)
DROP POLICY IF EXISTS "feedback_attachments_definer_select" ON "feedback_attachments";
CREATE POLICY "feedback_attachments_definer_select" ON "feedback_attachments" FOR SELECT TO CURRENT_USER USING (true);
DROP POLICY IF EXISTS "feedback_attachments_definer_update" ON "feedback_attachments";
CREATE POLICY "feedback_attachments_definer_update" ON "feedback_attachments" FOR UPDATE TO CURRENT_USER
  USING (true) WITH CHECK (true);

-- blob_files -----------------------------------------------------------------------------------------------
ALTER TABLE "blob_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "blob_files" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "blob_files" TO authenticated;

DROP POLICY IF EXISTS "blob_files_owner_select" ON "blob_files";
CREATE POLICY "blob_files_owner_select" ON "blob_files" FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "blob_files_owner_insert" ON "blob_files";
CREATE POLICY "blob_files_owner_insert" ON "blob_files" FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "blob_files_owner_delete" ON "blob_files";
CREATE POLICY "blob_files_owner_delete" ON "blob_files" FOR DELETE
  USING (user_id = auth.uid());

-- Sin UPDATE: un archivo guardado no se modifica. Lectura y borrado de las funciones admin_* (la descarga del
-- admin y la limpieza de adjuntos de lo resuelto, R29-05 y R29-09).
DROP POLICY IF EXISTS "blob_files_definer_select" ON "blob_files";
CREATE POLICY "blob_files_definer_select" ON "blob_files" FOR SELECT TO CURRENT_USER USING (true);
DROP POLICY IF EXISTS "blob_files_definer_delete" ON "blob_files";
CREATE POLICY "blob_files_definer_delete" ON "blob_files" FOR DELETE TO CURRENT_USER USING (true);

-- Lectura del admin ----------------------------------------------------------------------------------------
-- Mismo patrón que admin_beta_feedback (rls/0013) y admin_beta_feedback_triage (rls/0018): SECURITY DEFINER,
-- search_path fijo, objetos calificados, barrera app_admins, REVOKE de PUBLIC y EXECUTE solo para authenticated.
-- La persona sale con su identificador seudónimo (6 caracteres del sha256 del user_id): nunca email ni nombre.
-- Los borradores no se ven: el admin lee solo lo que la persona envió.

-- Lista de informes enviados, el más reciente primero, con los conteos del resumen.
DROP FUNCTION IF EXISTS public.admin_feedback_reports(integer);
CREATE FUNCTION public.admin_feedback_reports(p_limit integer DEFAULT 100)
RETURNS TABLE (
  id uuid,
  person text,
  status text,
  sent_at timestamptz,
  status_changed_at timestamptz,
  items integer,
  screenshots integer,
  documents integer,
  items_new integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_feedback_reports: no autorizado';
  END IF;
  RETURN QUERY
  SELECT r.id,
         left(encode(sha256(convert_to(r.user_id::text, 'UTF8')), 'hex'), 6),
         r.status,
         r.sent_at,
         r.status_changed_at,
         (SELECT count(*)::integer FROM public.feedback_items i WHERE i.report_id = r.id),
         (SELECT count(*)::integer FROM public.feedback_attachments a
            JOIN public.feedback_items i ON i.id = a.item_id
           WHERE i.report_id = r.id AND a.kind = 'image' AND a.deleted_at IS NULL),
         (SELECT count(*)::integer FROM public.feedback_attachments a
            JOIN public.feedback_items i ON i.id = a.item_id
           WHERE i.report_id = r.id AND a.kind IN ('pdf', 'docx') AND a.deleted_at IS NULL),
         (SELECT count(*)::integer FROM public.feedback_items i WHERE i.report_id = r.id AND i.status = 'nuevo')
    FROM public.feedback_reports r
   WHERE r.status <> 'borrador'
   ORDER BY r.sent_at DESC, r.id DESC
   LIMIT least(greatest(coalesce(p_limit, 100), 1), 200);
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_feedback_reports(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_feedback_reports(integer) TO authenticated;

-- Un informe enviado, por ítem y adjunto (una fila por adjunto; un ítem sin adjuntos sale una vez con los datos
-- del adjunto en null). Los adjuntos borrados no salen. Un borrador o un id inexistente devuelven 0 filas.
DROP FUNCTION IF EXISTS public.admin_feedback_report(uuid);
CREATE FUNCTION public.admin_feedback_report(p_report_id uuid)
RETURNS TABLE (
  report_id uuid,
  person text,
  report_status text,
  sent_at timestamptz,
  item_id uuid,
  item_position integer,
  path text,
  category text,
  message text,
  item_status text,
  item_status_changed_at timestamptz,
  attachment_id uuid,
  attachment_name text,
  attachment_kind text,
  attachment_mime text,
  attachment_bytes integer,
  attachment_width integer,
  attachment_height integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_feedback_report: no autorizado';
  END IF;
  RETURN QUERY
  SELECT r.id,
         left(encode(sha256(convert_to(r.user_id::text, 'UTF8')), 'hex'), 6),
         r.status,
         r.sent_at,
         i.id,
         i.position::integer,
         i.path,
         i.category,
         i.message,
         i.status,
         i.status_changed_at,
         a.id,
         a.original_name,
         a.kind,
         a.mime,
         a.bytes,
         a.width,
         a.height
    FROM public.feedback_reports r
    JOIN public.feedback_items i ON i.report_id = r.id
    LEFT JOIN public.feedback_attachments a ON a.item_id = i.id AND a.deleted_at IS NULL
   WHERE r.id = p_report_id AND r.status <> 'borrador'
   ORDER BY i.position, a.created_at, a.id;
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_feedback_report(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_feedback_report(uuid) TO authenticated;
