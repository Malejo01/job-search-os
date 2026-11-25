# Plan R29 · Informe de revisión para testers y Afi v2 (25/11)

## Por qué
Ani quiere mandar toda su revisión de una sola vez, con mucho texto dictado, capturas y documentos. Hoy el modal «¿Algo no anduvo?» no le alcanza:
- **Mensaje:** máximo **2.000 caracteres** (`FEEDBACK_MESSAGE_MAX` en `packages/pipeline/src/feedback/beta-feedback.ts`, y un check en la base, `beta_feedback_message_length`). Ella lo vivió como «200»: el contador se llena rápido cuando dicta.
- **Voz:** cada grabación se corta a los **2 minutos** (`VOICE_MAX_SECONDS = 120`).
- **Adjuntos:** no hay.
- **Tope:** 10 envíos por día (`FEEDBACK_DAILY_LIMIT`).
- El 24/11 no quedó **ningún** comentario de ella guardado en la base: hay que ver además si algo falló al enviar (R29-01).

## Decisiones (Mauro, 25/11)
- **Solo testers y admins** (rol tester de `/admin/personas`, `ASSISTANT_TESTER_EMAILS` o `ADMIN_EMAILS`). El resto de la gente sigue con el modal de siempre (2.000 caracteres, sin adjuntos).
- **Sin límite práctico de texto** para testers. Técnicamente, un tope alto para que la base no reciba cualquier cosa: **50.000 caracteres por ítem**.
- **Voz:** varias grabaciones seguidas que se suman al texto, sin cortar lo ya dictado. Cada grabación sigue siendo de 2 minutos (costo y tiempo de respuesta), pero se puede grabar todas las veces que haga falta. Tope diario de minutos para testers: **60 minutos**.
- **Adjuntos:** imágenes (capturas), PDF y Word.
- **Ítem por ítem:** un informe con varios ítems; cada ítem lleva pantalla, texto o voz y adjuntos.
- **Guardado de archivos (por defecto):** en **Postgres**, como `raw_blobs` (ADR-007, el adaptador `storage` sobre Postgres), con topes y compresión en el navegador. Sin servicios nuevos ni costo extra. Si después hace falta más espacio, se cambia el adaptador a Vercel Blob sin tocar la pantalla. *Si Mauro prefiere Vercel Blob desde el arranque, se cambia acá antes de lanzar.*

## Tickets

### R29-01 · Diagnóstico del envío de comentarios
- Reproducir el envío del modal con un tester en local, en Chrome, Opera GX y el celular (390 px), con texto escrito y dictado.
- Revisar que el error del servidor (tope, validación, sesión vencida) se vea en pantalla y que el texto **no se pierda** si falla: guardar el borrador en `sessionStorage` y restaurarlo.
- e2e: envío correcto con «¡Gracias!», y envío fallido que conserva el texto.

### R29-02 · Datos: informes, ítems y adjuntos
- **Tablas nuevas**, todas con `user_id`, RLS y `FORCE` en la misma migración:
  - `feedback_reports`: id, user_id, título, estado (`borrador | enviado | visto | resuelto`), created_at, sent_at;
  - `feedback_items`: report_id, orden, pantalla (`path`), categoría, mensaje (hasta 50.000), estado propio (`nuevo | visto | resuelto`);
  - `feedback_attachments`: item_id, nombre original, tipo detectado, bytes, sha256, `blob_ref` (puntero al almacenamiento), ancho/alto si es imagen.
- **Adaptador `storage`:** `put`/`get`/`delete` con Postgres hoy (`bytea` en una tabla `blob_files` aparte, para no inflar las consultas), con la misma interfaz que tendría Vercel Blob.
- **Topes** (en `packages/pipeline`, con tests):
  - 30 ítems por informe y 10 adjuntos por ítem;
  - imagen: hasta 8 MB antes de comprimir, y menos de 1,5 MB después;
  - PDF y DOCX: hasta 10 MB;
  - 100 MB por persona en total.
- **Funciones `admin_*`** (SECURITY DEFINER) para que el admin lea los informes de todos, igual que `admin_beta_feedback()`.

### R29-03 · Pantalla «Mi informe de revisión» (solo testers)
- Ruta `/recorrido/informe` y un botón «Agregar al informe» en el modal «¿Algo no anduvo?» cuando la persona es tester.
- **Cada ítem tiene:**
  - la pantalla (elegida de la lista de `/recorrido` o la actual);
  - el texto largo, con un contador que solo avisa cerca de 50.000;
  - el botón de voz (`VoiceInput` de la R25), que va sumando las grabaciones;
  - los adjuntos:
    - arrastrar y soltar, elegir archivo o pegar con Ctrl+V (capturas);
    - **«Capturar esta pantalla»** con `getDisplayMedia` en la computadora, sin dependencias nuevas;
    - en el celular, elegir desde la galería.
- **Las imágenes se comprimen en el navegador** (canvas a WebP, lado mayor de 2.000 px).
- **Borrador:** se guarda solo en la base cada 10 segundos y al salir. Se puede seguir otro día.
- **«Enviar informe»:** pide confirmación, muestra el resumen («12 ítems, 18 capturas, 2 documentos») y avisa a los admins por email (Resend, sin adjuntos: solo el link).

### R29-04 · Seguridad de los adjuntos
- **Validación del tipo por los bytes** (magic bytes), no por la extensión ni por el `Content-Type`: PNG, JPEG, WebP, PDF y DOCX. Todo lo demás se rechaza.
- **Las imágenes se vuelven a codificar en el servidor:** sin EXIF ni GPS, y sin nada escondido.
- **Los archivos se sirven por una ruta con sesión:**
  - solo la dueña y los admins;
  - `Content-Disposition: attachment` para PDF y DOCX;
  - `X-Content-Type-Options: nosniff`;
  - CSP `sandbox`.
  - Nunca una URL pública.
- **Rate limit:** subidas por minuto y por día.
- **Los tests de seguridad,** al estilo red team de la S1 a la S5, van en `ops/seguridad/r29.md`.

### R29-05 · Vista del admin `/admin/informes`
- Lista de informes enviados.
- Por informe, los ítems en orden con su pantalla, el texto, las miniaturas de las capturas (un clic las abre grandes) y los documentos para descargar.
- Estado por ítem: nuevo, visto o resuelto.
- **«Exportar para Claude»:** un `.md` con todos los ítems y los links a los adjuntos, para que Claude arme la tanda de tickets desde ahí. Un `.zip` con los adjuntos solo si no suma dependencias; si las suma, va como paso manual.

### R29-06 · Topes de voz para testers
- Las grabaciones seguidas se suman sin pisar lo escrito: `joinDictated`, ya existe.
- Tope diario de minutos de voz por rol: `VOICE_TESTER_DAILY_MINUTES=60`, y el de siempre para el resto.
- Aviso claro al llegar al tope: «Por hoy llegaste al tope de voz: podés seguir escribiendo».

### R29-07 · Calidad
- e2e del informe completo: 3 ítems, dictado simulado, 2 capturas pegadas, 1 PDF, enviar y verlo en `/admin/informes`.
- 390 px y 360 px, teclado, axe.
- Capturas en `ops/capturas/r29/`.

### R29-08 · Afi v2 en toda la app
- Las 9 poses nuevas (gato con anteojos, traje violeta, corbata lima), la cara y el favicon ya están en `origin/ronda/r29-assets` con los mismos nombres de archivo; `MASCOTA_ANCHOS`, los `alt` y el ancho del email, actualizados. La tanda revisa que se vean bien en todas las pantallas, en la OG y en los emails, y que no quede nada de la v1.

## Fuera de esta tanda
- Comentarios del admin dentro de cada ítem (responderle a Ani).
- Pasar el informe directo a tickets del BACKLOG.
- Vercel Blob, salvo que Mauro lo pida.

## Pasos manuales esperados
- Aplicar la migración y la RLS nuevas en Neon, con el OK de Mauro.
- `VOICE_TESTER_DAILY_MINUTES` en Vercel, si se quiere otro valor que 60.
- Probar con Ani en su navegador real y en el celular.
