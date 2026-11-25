Tanda R29 «Informe de revisión y Afi v2». Armá un **EQUIPO DE AGENTES** con 3 teammates y vos como lead. Mecánica, reglas y arranque: igual que en `ops/rondas/r22-tanda/prompt-r22-r21.md` §0 y §1.
- Ramas `ronda/r29-NN-<nombre>`.
- Migraciones desde la 0084. RLS reservadas: 0069 y 0070. e2e: 310 a 339.

**Base:** `origin/ronda/r29-assets`. Es `main` (con la R27 y la R28 ya mergeadas y sus migraciones aplicadas) más **Afi v2**: las 9 poses nuevas (gato con anteojos, traje violeta y corbata lima), la cara y el favicon, **con los mismos nombres de archivo**, y `MASCOTA_ANCHOS`, los `alt` y el ancho del email ya actualizados. **Leé primero `docs/beta/mascota.md`.** El plan completo de la tanda está en `docs/beta/plan-r29.md`.

El dueño puede no estar: **no pares a preguntar.** Ante la duda, lo más simple que falle cerrado, anotado en el informe.

## Reglas propias de esta tanda
- **USD 0 en modelos:**
  - no se toca ningún prompt;
  - la voz se prueba con el modelo simulado de los e2e.
- **Prohibido:**
  - nada contra Neon, Vercel ni Resend;
  - nada de merge.
- **Archivos adjuntos:** se guardan en **Postgres**, detrás del adaptador `storage` (ADR-007). Sin servicios nuevos, sin dependencias nuevas y sin Vercel Blob. ADR nuevo con la decisión y cómo se cambiaría a Blob más adelante.
- **Solo testers y admins** ven lo nuevo del informe. El modal «¿Algo no anduvo?» de todos los demás queda igual: 2.000 caracteres y sin adjuntos.
- **Seguridad primero en los adjuntos:** todo hallazgo, con su test. Lo sensible va a `ops/seguridad/r29.md`, nunca al repo.
- **Si el guard no te deja copiar, borrar o instalar,** anotalo en los pasos manuales con el comando exacto.

## Equipo y tickets
| Teammate | Tickets en orden |
|---|---|
| **informe** | R29-01 → R29-02 → R29-03 |
| **seguridad** | R29-04 → R29-05 → R29-06 |
| **afi** | R29-08 → R29-07 |

`informe` y `seguridad` comparten el esquema: **R29-02 va primero.** `seguridad` arranca por el diseño de R29-04, con tests de los validadores en `packages/pipeline`, mientras se cierra la migración.

### R29-01 · Diagnóstico del envío de comentarios
El 24/11 Ani usó la app toda la tarde (dictado incluido) y **no quedó ningún comentario guardado** en `beta_feedback`.
- Reproducí el envío del modal con un tester en local, en Chrome, en Opera GX (UA de los e2e de voz) y a 390 px, con texto escrito y con texto dictado.
- **Que el error se vea:** tope diario, validación, sesión vencida o error del servidor, cada uno con su mensaje en pantalla.
- **Que el texto no se pierda nunca:** borrador en `sessionStorage`, restaurado al reabrir el modal y borrado solo al recibir «¡Gracias!».
- **e2e:** envío correcto, y envío que falla conservando el texto.

### R29-02 · Datos: informes, ítems y adjuntos (carril rojo)
- **Tablas nuevas,** cada una con `user_id`, RLS y `FORCE` en la misma migración:
  - `feedback_reports`: estado `borrador | enviado | visto | resuelto`;
  - `feedback_items`: pantalla (`path`), categoría, mensaje de hasta 50.000 caracteres, orden y estado `nuevo | visto | resuelto`;
  - `feedback_attachments`: nombre original, tipo detectado, bytes, sha256, `blob_ref` y ancho y alto si es imagen;
  - `blob_files`: `bytea`, aparte, para no inflar las consultas.
- **Adaptador `storage`:** `put`, `get` y `delete`, con la interfaz que tendría Vercel Blob.
- **Topes en `packages/pipeline`,** con tests primero:
  - 30 ítems por informe;
  - 10 adjuntos por ítem;
  - imagen de hasta 8 MB, y menos de 1,5 MB ya comprimida;
  - PDF y DOCX de hasta 10 MB;
  - 100 MB por persona.
- **Funciones `admin_*`** (SECURITY DEFINER) para leer los informes de todos, como `admin_beta_feedback()`.
- **Integración:** RLS por persona y que el admin vea todo.

### R29-03 · Pantalla «Mi informe de revisión» (solo testers)
- **Dónde:** `/recorrido/informe`, y un botón «Agregar al informe» en el modal «¿Algo no anduvo?» cuando la persona es tester.
- **Cada ítem tiene:**
  - la pantalla, elegida de la lista de `/recorrido` o la actual;
  - el texto largo, con un contador que solo avisa cerca de 50.000;
  - la voz (`VoiceInput`): varias grabaciones de 2 minutos seguidas, que se suman con `joinDictated` sin pisar lo escrito;
  - los adjuntos:
    - arrastrar y soltar, elegir archivo o pegar con Ctrl+V (capturas);
    - **«Capturar esta pantalla»** con `getDisplayMedia` en la computadora, sin dependencias nuevas;
    - la galería en el celular.
- **Imágenes comprimidas en el navegador:** canvas a WebP, lado mayor de 2.000 px.
- **Borrador** guardado en la base cada 10 segundos y al salir: se puede seguir otro día.
- **«Enviar informe»:**
  - confirmación con el resumen («12 ítems, 18 capturas, 2 documentos»);
  - aviso a los admins por email, solo con el link (el email se prueba con el adaptador simulado).
- **Afi acompaña con `AfiDice`:**
  - `explicando`: «Contame todo lo que viste: podés escribir, dictar y sumar capturas»;
  - `motivacion` al enviar.
  - Los textos van a `textos-rediseno.ts` para que Ani los apruebe.

### R29-04 · Seguridad de los adjuntos
- **Tipo por los bytes** (magic bytes), no por la extensión ni por el `Content-Type`: PNG, JPEG, WebP, PDF y DOCX. Todo lo demás se rechaza.
- **Las imágenes se vuelven a codificar en el servidor:** sin EXIF, sin GPS y sin nada escondido. Sin dependencias nuevas: si no se puede, se acepta solo WebP producido por el navegador y se verifica su estructura, anotado en el informe.
- **Ruta de descarga con sesión:**
  - solo la dueña y los admins;
  - `Content-Disposition: attachment` para PDF y DOCX;
  - `X-Content-Type-Options: nosniff`;
  - CSP `sandbox`.
  - Nunca una URL pública.
- **Rate limit:** subidas por minuto y por día. Todas las server actions nuevas van al carril rojo y a CODEOWNERS.
- **Pruebas tipo red team:**
  - un archivo disfrazado;
  - un SVG o HTML con extensión `.png`;
  - un PDF con JavaScript;
  - zip bomb (DOCX);
  - path traversal en el nombre;
  - ver el adjunto de otra persona;
  - pasar los topes.

### R29-05 · Vista del admin `/admin/informes`
- **Lista** de los informes enviados.
- **Por informe,** sus ítems en orden:
  - la pantalla;
  - el texto;
  - las miniaturas, que se abren grandes;
  - los documentos para descargar;
  - el estado de cada ítem.
- **«Exportar para Claude»:** un `.md` con todos los ítems y los links a los adjuntos. Un `.zip` solo si no suma dependencias; si no se puede, va a los pasos manuales.
- Link desde el menú de `/admin` y desde la checklist de apertura.

### R29-06 · Topes de voz para testers
- **Tope diario de minutos de voz por rol:** `VOICE_TESTER_DAILY_MINUTES`, 60 por defecto. El del resto, igual que hoy.
- **Al llegar al tope:** «Por hoy llegaste al tope de voz: podés seguir escribiendo». Lo dictado no se pierde.
- Tests en `packages/pipeline` y un e2e.

### R29-07 · Calidad del informe
- **e2e completo:**
  1. 3 ítems;
  2. dictado simulado;
  3. 2 capturas pegadas;
  4. 1 PDF;
  5. enviar;
  6. verlo en `/admin/informes`;
  7. exportar el `.md`.
- 390 px y 360 px, teclado, axe sin violaciones serias.
- Capturas en `ops/capturas/r29/`.

### R29-08 · Afi v2 en toda la app (revisión visual)
Las imágenes ya están en la base con los mismos nombres, así que el código no cambia. Lo que hay que revisar es que se vean bien:
- **Proporciones:** `quieto` es más angosto y `saludando` y `trabajando` más anchos que en la v1. Revisá `AfiDice`, el botón del asistente (la cara nueva), los vacíos, el 404, `global-error`, la portada, la lista de espera, el festejo, Interview, el CV, Academy y `/ayuda`, en claro y oscuro, a 390 y 1280 px:
  - nada cortado;
  - nada que tape texto;
  - el círculo lavanda centrado.
- **Fuera de la app:**
  - la imagen para compartir (OG, `next/og`) con Afi v2;
  - los emails de bienvenida y vencimiento (el ancho ya es de 114 px);
  - el favicon en la pestaña.
- **Que no quede la v1 en ningún lado:** imágenes viejas, textos que hablen del visor o de los auriculares, y capturas de referencia en los tests.
- **LCP de la portada:** igual o mejor que en la R28.
- **Capturas** antes y después en `ops/capturas/r29/afi-v2/`.

## Cierre
- **Rama `ronda/r29-cierre`:**
  - Bloque 47 del BACKLOG;
  - `docs/beta/informe-r29.md`;
  - `docs/beta/pasos-manuales-r29.md`, con:
    - la migración y la RLS para Neon;
    - `VOICE_TESTER_DAILY_MINUTES`;
    - la prueba con Ani en su navegador real y en el celular.
- **`ops/ESTADO.md`** actualizado.
- **Mensaje final al dueño, en 5 líneas.**
- **No sigas con otra tanda.**
