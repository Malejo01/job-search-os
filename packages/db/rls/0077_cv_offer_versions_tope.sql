-- Tope de versiones del CV por oferta (R34-02, decisión del 27/11). Idempotente: corre en cada db:migrate.
--
-- Hasta 3 versiones por persona y oferta: al guardar la cuarta se borra la más vieja (la app avisa). El tope vive
-- en la base para que falle cerrado aunque haya dos guardados a la vez: el trigger serializa por persona y oferta
-- con un candado de transacción y recién ahí borra lo que sobra.
--
-- Corre con los permisos de quien inserta (SECURITY INVOKER), así que el DELETE pasa por la RLS de 0076: nunca toca
-- filas de otra persona. Si alguien intenta insertar a nombre de otra cuenta, el DELETE no ve nada y después el
-- WITH CHECK de la política de INSERT rechaza la fila.

DROP TRIGGER IF EXISTS "cv_offer_versions_tope" ON "cv_offer_versions";
DROP FUNCTION IF EXISTS public.cv_offer_versions_tope();
CREATE FUNCTION public.cv_offer_versions_tope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('cv_offer_versions:' || NEW.user_id::text || ':' || NEW.job_id::text, 0));
  DELETE FROM public.cv_offer_versions v
   WHERE v.id IN (
     SELECT o.id FROM public.cv_offer_versions o
      WHERE o.user_id = NEW.user_id AND o.job_id = NEW.job_id
      ORDER BY o.created_at DESC, o.id DESC
     OFFSET 2
   );
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.cv_offer_versions_tope() FROM PUBLIC;

CREATE TRIGGER "cv_offer_versions_tope"
  BEFORE INSERT ON "cv_offer_versions"
  FOR EACH ROW EXECUTE FUNCTION public.cv_offer_versions_tope();
