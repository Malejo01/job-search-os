-- Borrado de cuenta (JS-092). Idempotente: se aplica en cada pnpm db:migrate.
-- Archivo aparte para no tocar 0000 (base) ni 0001 (invitaciones).

-- users: el usuario puede borrar SOLO su propia fila (la app corre como jobsearch_app dentro de
-- withUser). Sin esta policy el DELETE da 0 filas sin error; deleteUserData lo detecta y hace rollback.
DROP POLICY IF EXISTS "users_self_delete" ON "users";
CREATE POLICY "users_self_delete" ON "users" FOR DELETE USING (id = auth.uid());

-- learning_resources es catálogo compartido (lectura abierta, sin escritura para la app). Al borrar
-- la cuenta, el autor puede: (a) borrar sus recursos NO aprobados; (b) soltar la autoría de los
-- aprobados (created_by_user_id = NULL), que quedan en el catálogo. Nada más.
DROP POLICY IF EXISTS "learning_resources_creator_delete_unapproved" ON "learning_resources";
CREATE POLICY "learning_resources_creator_delete_unapproved" ON "learning_resources" FOR DELETE
  USING (created_by_user_id = auth.uid() AND NOT approved);
DROP POLICY IF EXISTS "learning_resources_creator_release" ON "learning_resources";
CREATE POLICY "learning_resources_creator_release" ON "learning_resources" FOR UPDATE
  USING (created_by_user_id = auth.uid() AND approved) WITH CHECK (created_by_user_id IS NULL);

-- La policy UPDATE no limita columnas: este trigger hace que el rol de la app solo pueda cambiar
-- created_by_user_id (cualquier otro cambio falla). El dueño/seed (otro rol) no se ve afectado.
CREATE OR REPLACE FUNCTION learning_resources_app_release_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF current_user = 'jobsearch_app'
     AND (to_jsonb(NEW) - 'created_by_user_id') IS DISTINCT FROM (to_jsonb(OLD) - 'created_by_user_id') THEN
    RAISE EXCEPTION 'learning_resources: la app solo puede soltar created_by_user_id';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS learning_resources_app_release_only ON "learning_resources";
CREATE TRIGGER learning_resources_app_release_only BEFORE UPDATE ON "learning_resources"
  FOR EACH ROW EXECUTE FUNCTION learning_resources_app_release_only();
