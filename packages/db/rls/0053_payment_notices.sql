-- «Ya pagué» (R22-01): avisos de pago que carga la persona para que el equipo los confirme a mano.
-- Idempotente: corre en cada db:migrate.
--
-- `payment_notices` guarda solo el plan pedido, el número de operación (opcional, solo dígitos), el estado y las
-- fechas: nada de montos, nombres ni datos de la tarjeta. Acá:
--   * cada persona LEE solo los suyos y los INSERTA solo con su user_id y en estado `pendiente` (no puede
--     crearse un aviso ya activado);
--   * ninguna persona actualiza ni borra: pasar a `activado` o `rechazado` lo hace el admin (R22-02) por una
--     función SECURITY DEFINER con la barrera app_admins, como `admin_plan_override_set` (0022). Las policies
--     TO CURRENT_USER son para esas funciones y el cron (dueño de la tabla);
--   * el tope de 3 avisos pendientes por persona lo impone un trigger BEFORE INSERT con un lock de
--     transacción por persona, así dos envíos a la vez no pasan el tope (falla cerrado, sin depender del código).
-- Al borrar la cuenta las filas caen por ON DELETE CASCADE.
ALTER TABLE "payment_notices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_notices" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_notices_owner_select" ON "payment_notices";
CREATE POLICY "payment_notices_owner_select" ON "payment_notices" FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "payment_notices_owner_insert" ON "payment_notices";
CREATE POLICY "payment_notices_owner_insert" ON "payment_notices" FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'pendiente'
    AND reject_reason IS NULL
    AND resolved_at IS NULL
  );

-- Con FORCE RLS el dueño queda sujeto a las policies si su rol no tiene BYPASSRLS (Neon): TO CURRENT_USER es el
-- rol que aplica la migración, dueño de la tabla y de las funciones. El rol de la app no queda alcanzado.
DROP POLICY IF EXISTS "payment_notices_definer_select" ON "payment_notices";
CREATE POLICY "payment_notices_definer_select" ON "payment_notices" FOR SELECT TO CURRENT_USER
  USING (true);
DROP POLICY IF EXISTS "payment_notices_definer_insert" ON "payment_notices";
CREATE POLICY "payment_notices_definer_insert" ON "payment_notices" FOR INSERT TO CURRENT_USER
  WITH CHECK (true);
DROP POLICY IF EXISTS "payment_notices_definer_update" ON "payment_notices";
CREATE POLICY "payment_notices_definer_update" ON "payment_notices" FOR UPDATE TO CURRENT_USER
  USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "payment_notices_definer_delete" ON "payment_notices";
CREATE POLICY "payment_notices_definer_delete" ON "payment_notices" FOR DELETE TO CURRENT_USER
  USING (true);

-- 0030 retira los permisos de toda tabla sin RLS y corre antes: como esta ya tiene RLS, se devuelven solo los
-- que la persona necesita (leer e insertar). Sin UPDATE ni DELETE para la app.
GRANT SELECT, INSERT ON "payment_notices" TO authenticated;
REVOKE UPDATE, DELETE ON "payment_notices" FROM authenticated;

-- Tope de avisos pendientes: 3 por persona. El lock serializa los inserts de una misma persona; con
-- READ COMMITTED, el conteo posterior al lock ya ve lo que confirmó el envío anterior.
CREATE OR REPLACE FUNCTION public.payment_notices_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NEW.status = 'pendiente' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('payment_notices:' || NEW.user_id::text, 0));
    IF (SELECT count(*) FROM public.payment_notices p
         WHERE p.user_id = NEW.user_id AND p.status = 'pendiente') >= 3 THEN
      RAISE EXCEPTION 'payment_notices: tope de avisos pendientes' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.payment_notices_cap() FROM PUBLIC;

DROP TRIGGER IF EXISTS payment_notices_cap ON "payment_notices";
CREATE TRIGGER payment_notices_cap BEFORE INSERT ON "payment_notices"
  FOR EACH ROW EXECUTE FUNCTION public.payment_notices_cap();
