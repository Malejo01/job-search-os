# ADR-047: Adjuntos del informe de revisión en Postgres

**Status:** Proposed · **Date:** 2026-11-25 · **Relacionada:** ADR-002, ADR-007, ADR-044, ADR-045

## Context
- «Mi informe de revisión» (R29) deja que testers y admins armen un informe largo (hasta 30 ítems de 50.000 caracteres) con capturas, PDF y DOCX.
- ADR-007 ya definió el adaptador `storage` para los crudos de ingesta (texto, `raw_blobs`, refs `pg:<uuid>`), con Postgres hoy y un almacén de objetos mañana.
- Hay que guardar archivos binarios sin servicios nuevos ni dependencias nuevas, con aislamiento por persona (ADR-002) y sin que el volumen se dispare: los usuarios son pocos y la base gratuita de Neon tiene 1 GB.
- Vercel limita el cuerpo de una función a 4,5 MB por pedido.

## Decision
1. **Los archivos van en Postgres**, tabla `blob_files` (`bytea`), aparte de `feedback_attachments` (metadatos) para que listar adjuntos nunca traiga los bytes. Ambas con `user_id`, RLS y `FORCE` en la misma migración (0084 y `rls/0069`), y borradas con la cuenta por `ON DELETE CASCADE`.
2. **Adaptador binario `BinaryStorage`** (`packages/adapters/src/storage/binary.ts`): `put({ userId, contentType, bytes })`, `get(ref)` y `delete(ref)`, con refs opacas `pgb:<uuid>`. Es una interfaz aparte de `BlobStorage` (texto): los crudos de ingesta no se tocan. Se usa con la transacción de la persona (`withUser`), así las policies de `blob_files` hacen el aislamiento. Quien guarda la ref no sabe dónde están los bytes.
3. **Topes** (los valida `packages/pipeline`; la base repite los de forma con CHECK):
   - 30 ítems por informe y 10 adjuntos por ítem;
   - imagen: hasta 8 MB antes de comprimir y menos de 1,5 MB ya comprimida;
   - PDF y DOCX: hasta 10 MB (la base corta cualquier archivo en 10 MB);
   - **100 MB por persona** y **400 MB para todos los adjuntos juntos** (`FEEDBACK_FILES_GLOBAL_MAX_MB`; Neon Free tiene 1 GB). Falla cerrado: al llegar al tope global no se acepta ningún adjunto nuevo.
4. **Límite físico de Vercel:** la subida acepta hasta **4 MB por pedido** (`FEEDBACK_UPLOAD_REQUEST_MAX_BYTES`). Un documento más grande se rechaza en el navegador, antes de subir («Por ahora, documentos de hasta 4 MB»). Los topes de 8 y 10 MB quedan como topes del modelo de datos.
5. **Imágenes sin librerías nuevas:** el navegador siempre las pasa a WebP (canvas, lado mayor de 2.000 px). El servidor detecta el tipo por los bytes (no por la extensión ni el `Content-Type`) y **guarda solo WebP**, reescrito dejando únicamente los fragmentos de imagen (sin EXIF, XMP ni perfil de color) y con el ancho y el alto validados.
6. **Acceso:** subida por `POST /api/feedback-files` (route handler, no server action) y descarga por `GET /api/feedback-files/[id]`, con sesión: solo la dueña y los admins, nunca una URL pública; `Content-Disposition: attachment` para PDF y DOCX, `nosniff` y CSP `sandbox`. El admin lee por funciones `SECURITY DEFINER` (`rls/0069` y `0070`), no por las policies de la app.
7. **Congelado al enviar:** mientras el informe es borrador la persona edita ítems y adjuntos; al enviarlo, la RLS no deja cambiarlo ni borrarlo ni ponerle ella misma `visto` o `resuelto`. Los estados los cambia el admin por función.
8. **Limpieza:** los adjuntos de un ítem resuelto hace más de 30 días se pueden borrar (la fila de `blob_files` se elimina y `feedback_attachments.deleted_at` queda marcado). El texto del ítem no se borra nunca. Las columnas `status_changed_at` y `deleted_at` ya están en la migración 0084 por esto.

## Cómo se cambiaría a Vercel Blob (u otro almacén)
1. Una segunda implementación de `BinaryStorage` (`vercelBlobStorage`), con refs `blob:<clave>`; `get` devolvería los bytes con una descarga autenticada del lado del servidor (el almacén no se expone público).
2. La ruta de descarga ya decide por el prefijo de la ref (`parsePgBinaryRef` devuelve `null` para refs ajenas), así que las dos implementaciones conviven: las refs `pgb:` siguen sirviendo desde Postgres mientras las nuevas van a Blob.
3. Migración de lo existente: un script que lee cada `blob_files` (por persona, con el rol de servicio), lo sube a Blob, actualiza `feedback_attachments.blob_ref` a la ref nueva y recién después borra la fila de `blob_files`. Es repetible y se puede cortar a la mitad.
4. Con Blob desaparece el límite de 4 MB por pedido (subida directa del navegador con un token firmado de corta vida); ese cambio, y la subida en partes, es un ticket futuro. Los topes por persona y global se seguirían contando con `feedback_attachments.bytes`, no con `blob_files`.

## Alternativas descartadas
- **Vercel Blob desde el día uno:** suma un servicio, un token y un modelo de acceso (las URLs de Blob son difíciles de mantener privadas) para un volumen de decenas de archivos.
- **Guardar el archivo en `feedback_attachments`:** cada listado del admin traería los bytes. La tabla aparte es barata y deja los metadatos livianos.
- **Reusar `raw_blobs`:** es texto (`body text`) y tiene otras reglas de retención y de cuota; mezclar binarios ahí ensucia la purga de crudos.
- **Servidor de imágenes (sharp):** dependencia nueva con binarios nativos; el WebP que produce el navegador y se verifica en el servidor alcanza.

## Consecuencias
- La base crece con los adjuntos: de ahí los dos topes (persona y global) y la limpieza de lo resuelto. Hay que mirar el espacio de Neon antes de abrir el informe a más personas.
- Un archivo de 4 MB pasa por la función y por la conexión de la base: el pedido es más lento que una subida directa a un almacén de objetos. Es aceptable para uso interno de pocas personas.
- Borrar un ítem o un informe en borrador borra las filas de `feedback_attachments` por cascade, pero **no** los de `blob_files` (no hay FK, la ref es opaca): quien borra tiene que llamar antes a `BinaryStorage.delete` por cada adjunto. Borrar la cuenta sí se lleva todo.
