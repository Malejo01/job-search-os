-- JS-115: rescata el email_id de las filas que ya existen (estaba solo dentro del crudo en raw_blobs) para
-- que el webhook no las guarde de nuevo si Svix reintenta un email recibido antes del deploy. Es solo
-- datos: la columna y el índice único los crea 0052.
-- Si por la vieja búsqueda en los crudos (sin índice ni lock) quedó algún email repetido, la fila más
-- vieja se queda con el email_id y las demás quedan en null: así el índice único no puede fallar.
-- Idempotente: solo toca filas con email_id null y no repite un valor que ya esté tomado.
WITH found AS (
  SELECT ie.id,
         ie.received_at,
         substring(rb.body FROM '"email_id":"([^"]+)"') AS email_id
    FROM inbound_emails ie
    JOIN raw_blobs rb ON ie.raw_ref = 'pg:' || rb.id::text
   WHERE ie.email_id IS NULL
),
first_per_email AS (
  SELECT DISTINCT ON (email_id) id, email_id
    FROM found
   WHERE email_id IS NOT NULL
   ORDER BY email_id, received_at, id
)
UPDATE inbound_emails ie
   SET email_id = f.email_id
  FROM first_per_email f
 WHERE ie.id = f.id
   AND NOT EXISTS (SELECT 1 FROM inbound_emails o WHERE o.email_id = f.email_id);
