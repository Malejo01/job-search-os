# Informe de la tanda R29 «Informe de revisión y Afi v2» (25/11)

Plan: [`plan-r29.md`](plan-r29.md). Pasos manuales: [`pasos-manuales-r29.md`](pasos-manuales-r29.md). Cadena sobre `origin/ronda/r29-assets`; ningún PR, ningún merge. USD 0: ningún prompt tocado y ningún modelo llamado (voz con el transcriptor simulado). Nada contra Neon, Vercel ni Resend.

## Qué hay
- **El modal «¿Algo no anduvo?» ya no pierde nada (R29-01).** Cada error se ve en pantalla: sesión vencida (con link para entrar en otra pestaña), tope diario, validación y error del servidor. El texto queda en un borrador hasta el «¡Gracias!», y hay un aviso al pasar 2.000 caracteres (antes el dictado se cortaba sin avisar). Para la gente común el modal sigue igual: 2.000 caracteres y sin adjuntos.
- **«Mi informe de revisión» para testers y admins (R29-02 y R29-03).** En `/recorrido/informe`, un informe con hasta 30 ítems. Cada ítem tiene pantalla, texto de hasta 50.000 caracteres, voz que se suma sin pisar lo escrito y hasta 10 adjuntos (soltar, elegir, Ctrl+V, «Capturar esta pantalla», galería en el celular). Las imágenes se comprimen en el navegador. El borrador se guarda solo y se puede seguir otro día. Al enviar, aviso por email a los admins, solo con el link. Afi acompaña con `AfiDice`.
- **Adjuntos seguros (R29-04).** Tipo por los bytes (PNG, JPEG, WebP, PDF, DOCX); PDF con acciones o JavaScript, DOCX con macros y zip bombs, rechazados. Las imágenes se guardan como WebP reescrito sin metadatos. Las descargas van por una ruta con sesión (dueña o admin), con `nosniff`, CSP `sandbox` y `attachment` para documentos; nunca una URL pública. Ritmo por minuto y por día.
- **`/admin/informes` (R29-05).** Lista, detalle con miniaturas y documentos, estado por ítem y «Exportar para Claude» (`.md` que avisa que el texto es dato y no instrucción). Links desde `/admin` y desde la checklist de apertura.
- **Voz para testers (R29-06).** 60 minutos por día por la vía del servidor (`VOICE_TESTER_DAILY_MINUTES`) y aviso al llegar al tope: «Por hoy llegaste al tope de voz: podés seguir escribiendo».
- **Limpieza de adjuntos de lo resuelto (R29-09, cola extra).** Un adjunto se borra solo si su ítem está resuelto hace 30 días. El texto no se borra nunca: queda «adjunto borrado el <fecha>». Hay un botón general y otro por ítem, con confirmación y registro en `admin_events`. El cron diario está apagado por defecto.
- **Afi v2 revisada en toda la app (R29-08).** Claro y oscuro, a 390 y 1280 px, OG, emails y favicon: nada cortado ni tapado, el círculo centrado y ningún resto de la v1. No hizo falta cambiar código de producción.

## Ramas (alcanza con `ronda/r29-cierre`)
`ronda/r29-02-datos` → `r29-01-envio` → `r29-04-adjuntos` (04+06) → `r29-03-informe` → `r29-05-admin` (05+09) → `r29-08-afi` (08+07) → `r29-cierre`. Las intermedias pueden no compilar solas. Carril rojo.

## Decisiones del lead
- **Adjuntos en Postgres** (`blob_files`, `bytea`) detrás de un adaptador binario con `put`/`get`/`delete`. El de texto (`raw_blobs`) no se toca. ADR-047, con cómo pasar a Vercel Blob.
- **4 MB por documento.** Vercel corta cada pedido en 4,5 MB, así que el tope de 10 MB del plan no se puede subir de una vez. Queda en el código para la subida en partes o Blob.
- **400 MB para todos los adjuntos juntos**, además de los 100 MB por persona, porque Neon Free tiene 1 GB.
- **Imágenes sin `sharp`:** el navegador las pasa a WebP y el servidor reescribe el contenedor sin `EXIF`/`XMP`/`ICCP`. Un PNG o JPEG directo se rechaza.
- Subida y descarga por route handlers, no por server actions (por el tope de 1 MB). El autoguardado va de a un ítem por pedido, por el mismo tope.
- Migración extra **0085** (CHECK de `admin_events`) para la cola extra.

## Rendimiento
- LCP de la portada con Afi v2: +112 ms sobre la portada sin Afi (R28: +132). Es relativo: se midió con `next dev`, mediana de 5.
- Build no medido en esta tanda (el lote final se frenó por memoria). `/recorrido/informe` y `/admin/informes` son rutas nuevas, solo para testers y admins.

## Seguridad y privacidad
- Seguridad: 0 altos, 0 medios, 5 bajos (1 arreglado y 4 aceptados). La integración encontró y corrigió `GRANT` que faltaban en la RLS 0069. Detalle fuera del repo.
- Privacidad: el barrido marcaba un nombre propio en `plan-r29.md` y `prompt-r29.md` (del commit base, ya publicado). El cierre lo saca de los archivos, no de la historia: con squash merge no llega a `main`.

## Verificado
- typecheck 6/6 y lint (0 errores, 1 aviso) sobre todo el repo.
- Unitarios por teammate:
  - pipeline: feedback 148, attachment 60 y voz 62;
  - web: draft 9, informe 18, adjuntos y rutas 33 y admin 6, más otros;
  - integración de la base 334/334 (Testcontainers) y adaptador binario 6.
- e2e locales verdes: 330 (16 + 4 salteados de `global-error`), 332, 333 (12/12) y 310 (3/3).

## Sin verificar
- **El lote final de e2e y la suite unitaria completa los frenó el sistema por poca memoria**:
  - 311 se arregló después de su única corrida;
  - 312 a 319, 323 y 331 no corrieron nunca;
  - 321 y 322 se arreglaron sin volver a correr.
  - Comandos en los pasos manuales §5.
- Lo de admin de los e2e corre en el CI con `ADMIN_EMAILS`.
- Nada probado en un navegador real: portapapeles, `getDisplayMedia`, galería del celular, Opera GX.
- `global-error` no se pudo capturar.
- El diagnóstico del 24/11 no está confirmado en producción (pasos manuales §6).

## Pendientes que salen de la tanda
- Subida en partes (o Vercel Blob) para documentos de más de 4 MB.
- Ritmo propio en el servidor para guardar y agregar ítems.
- Escaneo de PDF con `/ObjStm` comprimido.
- Responderle a la tester dentro de cada ítem, y pasar el informe a tickets del BACKLOG (fuera de la tanda por plan).
- `.zip` con los adjuntos del informe (sin dependencias, no entró).
