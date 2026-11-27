# ADR-049: PDF del CV generado en el servidor, sin dependencia nueva

**Status:** Proposed · **Date:** 2026-11-26 · **Relacionada:** ADR-001, ADR-026, ADR-038

## Context
- «Guardar como PDF» abría el diálogo de impresión del navegador: el archivo dependía del navegador, de los encabezados y pies que la persona desactivara y del tamaño de hoja de su impresora. La revisión de diseño pidió un «Descargar PDF» que baje un archivo, igual a la vista previa, con texto seleccionable, tildes y eñes bien, A4 y links que se puedan tocar (C-48 a C-55).
- El PDF y el DOCX tienen que salir del mismo modelo (`CvDocument`, `packages/pipeline/src/cv-out/model.ts`): lo que la persona ve, descarga y lee un sistema de selección no puede diferir.
- El plan de la tanda preveía `pdf-lib`. Instalar dependencias está bloqueado en el equipo de agentes (`pnpm install` lo frena el guard y no se esquiva), y el CV es una columna de texto: no necesita imágenes, tablas ni fuentes incrustadas.

## Decision
1. **El PDF se genera en el servidor** a partir de `CvDocument`, en dos capas puras y sin I/O (ADR-001), con tests primero:
   - **Composición** (`pdf-layout.ts`): parte el texto en líneas y en páginas A4 con márgenes de 2 cm (los del DOCX). Una viñeta o un párrafo nunca se corta entre páginas; un título de sección viaja con su primera entrada, y el cargo con su detalle y su primera viñeta. Las URL se ven completas como texto y llevan su caja de link.
   - **Serializador** (`pdf-writer.ts`): PDF 1.4 mínimo y determinista. Fuentes estándar Helvetica y Helvetica-Bold (no se incrustan) con codificación **WinAnsi**, que cubre tildes, eñes, «¿¡» y la tipografía común. Texto real con operadores `Tj` (seleccionable y copiable). Links como anotaciones `/Link` con acción `/URI`, solo `https:`, `http:` y `mailto:`. Sin compresión, imágenes, scripts, fechas ni autor.
2. **Falla cerrado con los caracteres.** Lo que WinAnsi no tiene se reemplaza por el equivalente más cercano (`Ł` → `L`, `→` → `->`) o por `?`, y **siempre se informa** (`substitutions` en el resultado, un test lo cubre). El log del servidor guarda solo la cantidad, nunca el carácter ni el texto. El serializador lanza un error si recibe un carácter que no se pueda codificar: nunca escribe uno roto en silencio.
3. **Anchos de línea** con las métricas estándar de Helvetica (ASCII y Latin-1 exactos; unos pocos símbolos raros, aproximados). Un error de ancho solo mueve dónde se parte una línea, nunca el contenido.
4. **Descarga:** `GET /api/cv/pdf` (route handler), mismo contrato que `/api/cv/docx`: el usuario sale de la sesión (nunca de un parámetro), 401 sin sesión, datos leídos con `withUser` (RLS), respuesta `attachment` con `Cache-Control: no-store` y `nosniff`, nombre `CV-Nombre-Apellido.pdf` (solo ASCII). El archivo se arma en memoria: **no se guarda y no tiene URL pública**.
5. **Ritmo:** `decideCvDownload` (pura, `download-rate.ts`) decide con las marcas de tiempo de la persona: 6 por minuto y 40 por hora; sobre el tope, 429 con `Retry-After`. El almacén de marcas es memoria del proceso (`apps/web/lib/cv-download-rate.ts`): es un freno de mejor esfuerzo, no una cuota exacta, porque no hay tabla nueva en esta tarea.
6. **Interfaz:** botón «Descargar PDF» con estado «Generando tu archivo…» y, si falla, un mensaje con el siguiente paso («Probá de nuevo o descargá el otro formato»).

## Alternativa: `pdf-lib`
Si algún día se prefiere una librería (fuentes incrustadas, otros alfabetos, imágenes), el cambio es acotado: `pdf-layout.ts` (la composición) no cambia; se reemplaza `pdf-writer.ts` por un adaptador que recorra `PdfLayout` y dibuje cada línea y cada caja de link. Comando exacto, a cargo del responsable del proyecto:

```
pnpm --filter @job-search-os/web add pdf-lib
```

(y un adaptador en `apps/web/lib/`, porque `packages/pipeline` no debe depender de librerías con I/O). Después de eso, correr `pnpm --filter @job-search-os/pipeline test` y los e2e 420 en adelante. Con fuentes incrustadas ya no hace falta `normalizeForPdf` para lo que la fuente cubra.

## Consecuencias
- Cero dependencias nuevas y ningún binario ni fuente que revisar; el PDF es reproducible byte a byte.
- Solo alfabeto latino (WinAnsi). Nombres en otros alfabetos salen con `?` informado. Para el público de la beta (español e inglés) alcanza; si deja de alcanzar, es el motivo para pasar a `pdf-lib` con fuentes incrustadas.
- Sin compresión, un CV de dos páginas pesa unos pocos KB: no es un problema.
- **Limitación conocida del ritmo.** Se revisó lo existente sin migración: `person-quota.ts` cuenta espacio y filas (no tiempo), la descarga del DOCX y la de postulaciones no tienen ritmo, y el de los adjuntos (R29) cuenta filas de `feedback_attachments`, que solo existe porque cada subida deja una fila. Ninguno sirve para una descarga que no guarda nada. Por eso el ritmo vive en memoria de cada instancia: en Vercel cada instancia lleva su cuenta y casi no frena. Lo que sí limita el daño es que generar un PDF es barato y no llama a ningún modelo.
- El ritmo por proceso no frena a quien rebota entre instancias. Si hace falta un tope exacto, va una tabla con `user_id` y RLS (decisión aparte, con migración).
- Falta verificar a mano la apertura en tres lectores y la impresión en papel (C-55): son pasos manuales del responsable.
