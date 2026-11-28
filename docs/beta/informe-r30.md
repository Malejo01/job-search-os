# Informe de la tanda R30 «Confianza»

Cierre de la R30 (26/11). Especificación: `docs/beta/plan-r30-r34.md`; tickets: `docs/beta/prompt-r30.md`. Ningún modelo ni prompt: costo en modelos, USD 0. Los pasos para el responsable del proyecto están en `docs/beta/pasos-manuales-r30.md`; el estado de cada punto del informe de revisión, en `docs/beta/verificacion-informe-ani.md`.

## Qué entró por ticket

**R30-01 · Glosario, frases prohibidas y lista de verificación.** `packages/pipeline/src/glosario.ts` junta el glosario del plan, el buscador de frases prohibidas, `estadoRequisitoVisible` (un `no_cumple` sin dato del perfil es «Sin confirmar») y `riesgosVisibles` («Muchos candidatos» solo con el número del aviso). El test `apps/web/test/glosario-textos.test.ts` falla con una frase prohibida, «Aplicada» como estado, «skills», «match», «compatibilidad», «te falta» o «no cumple»; lo viejo está en listas de pendientes con dueño que solo pueden bajar. El estado «Aplicada» pasó a «Ya me postulé». Los bloques de textos nuevos están en `apps/web/lib/textos-rediseno.ts`. Se creó `docs/beta/verificacion-informe-ani.md` con las 159 filas.

**R30-02 · Los cuatro sellos.** `score-display.ts` devuelve niveles (`alta`, `media`, `baja`, `sin_evaluar`) y el corte usa el número ya redondeado a un decimal: el número nunca contradice al sello. El número va con un decimal y coma. La estimación previa ya no es un sello. «Cómo calculamos la afinidad» y la aclaración fija viven en `affinity-detail.tsx`. Emails y resumen diario no muestran sellos hoy.

**R30-03 · «Guardada».** Columna `jobs.saved_at` (migración 0086, con un índice parcial); no cambia `JOB_STATUSES`. Acciones «Guardar» y «Quitar de guardadas» con la sesión y el `user_id`; prueba de integración de que nadie guarda la oferta de otra persona. Pestaña «Guardadas» y marca en la tarjeta y en el detalle.

**R30-04 · La tarjeta.** Puesto, empresa, modalidad, sello con número, salario solo si está publicado y la línea «Sin confirmar: …» (hasta 2 cosas de la tabla de requisitos). Una condición excluyente que no coincide va arriba con texto e ícono y la oferta baja en el orden (regla pura en `packages/pipeline/src/listing/`, con tests). Botones «Ver oferta», «Guardar» y «Descartar». Una sola consulta para el listado.

**R30-05 · Pestañas, chips y contador.** Pestañas Por revisar, Guardadas, Ya me postulé, Descartadas y Todas; chips con su número y ×, contador real, «Limpiar filtros», estado de carga y filtros en la URL. «Aceptan {tu país}» solo con países, región o mundo explícitos; «Para empezar» usa la señal de nivel que ya existía.

**R30-06 · Descartadas.** Fondo neutro, «Descartada por vos», «Volver a revisar», «Ver oferta» y el aviso «Oferta descartada. [Deshacer]». Nada tachado ni solo por color.

**R30-07 · Vigencia.** «Este aviso ya no figura en {fuente}» solo para ofertas del pool cuya fuente dejó de mostrarlas (más de 14 días sin verse, con el pool actualizándose). Las demás no afirman nada. Bajan en el orden, no se ocultan.

**R30-08 · El detalle: orden y «Lo importante para decidir».** Nuevo orden con secciones plegables iguales en computadora y celular; siempre las 7 filas con «No especificado» cuando falta; «Cómo encaja» con el veredicto y hasta 3 cosas que más pesan; antes de evaluar, «Sin evaluar», «Evaluar esta oferta» y la estimación provisoria plegada.

**R30-09 · La evaluación, sin contradicciones.** `packages/pipeline/src/requirements/summary.ts` calcula conteos, condición bloqueante, «lo que más pesa» y la línea de la tarjeta desde la tabla de requisitos. Los paneles de bloqueadores, riesgos y fortalezas dejaron de contradecirla. Sección «Habilidades» con las que salen de la tabla.

**R30-10 · «Preparar mi postulación».** Una sola sección y un solo botón de salida («Ir a postularme en {sitio} ↗», arriba y fijo en el celular). La pregunta «¿Pudiste postularte?» sigue al volver; nada se marca solo.

**R30-11 · Valoración.** «¿Te sirve esta evaluación?»: «Sí» solo dice «Gracias»; «No» abre cuatro motivos. «Proponer otro puntaje» lo ven solo testers y admins, y la acción lo valida en el servidor.

**R30-12 · Base de legibilidad.** Tokens `text-body`, `text-secondary` y `text-meta`, tres colores de texto y la regla que falla (`apps/web/lib/legibilidad.ts` y su test). Las pantallas de ofertas quedaron en modo estricto, sin excepciones: sellos y chips a 12 px o más (la palabra del sello pasó debajo del círculo), sin transparencias en textos. Auditoría de lo que se ve: `apps/web/e2e/340-auditoria-legibilidad.spec.ts`. Documentación en `docs/ux/legibilidad.md`.

**R30-13 · Parser de sueldo.** No existía un parser desde texto. `parseSalaryText` y `salaryUsdFromText` (puros, fallan cerrado, 45 tests) entienden punto de miles, guion largo, «k», rangos con «a», moneda y periodicidad.

## Decisiones

- La migración 0086 es la única de la tanda; no hay RLS nueva (`jobs` ya tiene la suya).
- «Guardada» es una marca con fecha, no un estado. Guardar de nuevo conserva la fecha.
- Los chips del listado se calculan en memoria sobre las filas de la pestaña (una consulta); limitación: tope de 100 filas por consulta, como antes.
- «Descartar» solo en ofertas evaluadas, el único estado donde existe ese evento.
- La separación de habilidades ligadas al puesto frente a las de la empresa queda para la R31; hoy se muestran las que salen de la tabla.
- La estimación previa no es un sello: «Sin evaluar» nunca muestra un número.
- La palabra del sello salió del círculo y va debajo (no entra a 12 px dentro de un círculo de 56 a 62 px).
- Los textos que el plan fija «tal cual el informe» sin dar el texto quedaron con el más simple que cumple el glosario, marcados `PENDIENTE-INFORME` por ID.

## Lo no cumplido o con reservas

- **El informe de revisión no se pudo leer** (falta `pdftoppm`): las descripciones por ID salen del plan y de los prompts; los textos propuestos por el informe están sin cotejar. R-07 no figura en ningún ticket y queda «requiere decisión».
- **Parser de sueldo sin conectar** a ningún adaptador: no se sabe en qué fuente falló el caso del informe. Propuesta de una línea en `ops/rondas/r30-tanda/r30-13/informe.md`.
- **Rutas viejas:** `/jobs/[id]/postular` queda con su botón «Ir al aviso» propio; la R34 lo unifica con el botón de salida. El paso «marcá la oferta como aplicada» de `postular-view.ts` conserva la palabra vieja.
- **«Muchos candidatos» y fit-points:** `fit-points.ts` sigue en uso para la demo pública; no se borró.
- Specs 62 y 90 se redujeron: su premisa (listas de brechas y fortalezas del modelo en el detalle) ya no existe.
- Los bloques «en pocas palabras», «qué vas a hacer» y «qué buscan» están sin contenido a propósito (R31).
- La auditoría de legibilidad mide el zoom al 200 % con la mitad del ancho de ventana, no con el zoom real del navegador.

## Verificación

- `pnpm typecheck`: 6 de 6 paquetes, 0 errores.
- Lint: 0 errores (1 warning).
- Unit: pipeline 6857, web 634, db 196, adapters 1737 más 3 fallas de enlaces simbólicos de Windows (EPERM), conocidas y ajenas a esta tanda.
- Integración: `packages/db/src/job-saved.integration.test.ts`, 5 de 5 (Testcontainers).
- Privacidad: `node .claude/bin/privacy-scan.mjs` sin hallazgos nuevos en los archivos de la tanda.

## e2e

Corridos en local con `node .claude/bin/local.mjs e2e`, de a lotes y contra la base local (con `next dev`).

- **Nuevos, todos verdes:** 340 (auditoría: de 46 hallazgos a 0 en tres vueltas: barra de abajo a 12 px, botones del veredicto y la fila «← Ofertas · Anterior · Siguiente» con `flex-wrap`), 348 a 352 (listado), 358 a 361 (detalle) y 366 (capturas antes y después).
- **Viejos actualizados, verdes:** 01, 03, 04, 07, 09, 10, 33, 35, 38, 45, 47, 61, 62, 63, 86, 90, 108, 114, 116, 130, 187, 200, 257, 259, 270, 271, 278, 300, 301, 330.
- **Errores reales que encontraron los e2e y se arreglaron:** un panel viejo del detalle seguía diciendo «te falta» con su propio conteo (contradecía la tabla); el panel de `/jobs` contaba aparte; un `loading.tsx` bajo `/jobs` hacía que una oferta inexistente respondiera 200 en vez de 404 (se pasó a `Suspense` dentro de la página).
- **No verdes en local, por datos o entorno, no por la tanda:**
  - 81 y 79 («/plan: Simular») fallan porque la taxonomía de la base local está incompleta; 150 porque el registro de la base local va a `/hoy`. Hace falta `pnpm e2e:local:prepare`, que el guard no deja correr al equipo.
  - 153:73 falla en local porque quedó un `apps/web/app/(app)/jobs/loading.tsx` sin trackear que el guard no deja borrar; en la rama no existe.
  - 16 y 36 necesitan una cuenta tester o admin (`ADMIN_EMAILS`): en local se saltean, en el CI corren.
- Capturas: `ops/capturas/r30/` (antes y después, 390 y 1280 px, claro y oscuro) y `ops/capturas/r30/legibilidad/` (fuera del repo).
