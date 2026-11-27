# Verificación del informe de revisión, punto por punto

Una fila por cada uno de los 159 puntos del informe de revisión: **R-01 a R-38** (listado y detalle de la oferta), **S-01 a S-49** (evaluación y postulación) y **C-01 a C-72** (CV y mercado). La crea la R30 y la actualiza cada tanda de la cadena R30 a R34 (`docs/beta/cadena-r30-r34.md` §3).

- **Estados:** `hecho`, `parcial`, `pendiente`, `después de abrir` y `requiere decisión`.
- **Tanda:** el ticket que lo cubre, según `docs/beta/prompt-r30.md` a `prompt-r34.md`. Los que el plan deja para después (`docs/beta/plan-r30-r34.md` §12) llevan «después de abrir».
- **Cómo verlo:** la pantalla o el comando donde se comprueba.
- **Sobre las descripciones:** el informe original es privado y no va al repo. Cada descripción es una línea armada con lo que el plan y los tickets dicen de ese ID; no copia texto del informe. Si una fila no coincide con lo que dice el informe, vale el informe: corregir acá.

> Textos sin cotejar con el informe original: ver PENDIENTE-INFORME en `apps/web/lib/textos-rediseno.ts`. Las filas con «(descripción pendiente: cotejar con el informe)» no tienen su descripción en el plan ni en los prompts.

Estado al cierre de la R31 (26/11): se actualizaron las filas R-02, R-25 a R-29, S-02, S-05 a S-08, S-12, S-18, S-21 y S-22. Lo de la R31 solo se ve con `JOB_CARD=testers` (apagada, la app es la de la R30) y necesita las migraciones 0087 y 0088 y las RLS 0071 a 0073 aplicadas (`docs/beta/pasos-manuales-r31.md`). Las filas que dependen de `evaluate_job@v1.5.0` quedan `parcial` hasta medirla y promoverla.

Estado al cierre de la R32 (26/11): **ninguna fila cambia.** La R32 (inventario, alta por carrera, cobertura, fuentes y sueldo en la moneda original) no cubre ningún ID de los 159: el plan y `docs/beta/prompt-r32.md` no citan ninguno. Si al cotejar con el informe de revisión alguna fila resulta cubierta por R32-01 a R32-09, se actualiza acá. Ver `docs/beta/informe-r32.md`.

Estado al cierre de la R30 (26/11). `hecho` en una fila de la R30 quiere decir que el código está en la rama de cierre y probado con tests unitarios; los e2e los completa el lead en `docs/beta/informe-r30.md`. `parcial` quiere decir que falta otro ticket de la cadena o que el texto está sin cotejar con el informe.

## Parte 1 · Listado y detalle de la oferta (R-01 a R-38)

| ID | De qué trata | Tanda | Estado | Cómo verlo |
|---|---|---|---|---|
| R-01 | Vocabulario único de la interfaz (glosario) | R30-01 | parcial | `packages/pipeline/src/glosario.ts` y `apps/web/test/glosario-textos.test.ts`; queda «Match» (nombre del menú) para el barrido de la R34 |
| R-02 | Vocabulario único, caso «Esto mismo te pasa en N de tus M ofertas» | R30-01 y R31-08 | hecho | `/jobs/{id}` con `JOB_CARD=testers` y un dato repetido en 2 o más ofertas: frase y botón «Actualizar mi inglés» (solo ese campo); e2e 382 |
| R-03 | Estados con el nombre del glosario («Ya me postulé», no «Aplicada») | R30-01 | hecho | `/jobs?estado=aplicada` y el detalle de una oferta marcada como postulada |
| R-04 | Frases que predicen o comparan, fuera | R30-01 | hecho | Test del glosario; tarjeta y detalle sin «entre las mejores» ni «impide postular» |
| R-05 | Sello de afinidad con cuatro niveles | R30-02 | hecho | `/jobs` y el detalle de una oferta evaluada |
| R-06 | «Muchos candidatos» solo con el número del aviso | R30-01 | hecho | Detalle de una oferta evaluada con ese riesgo, con y sin número en el aviso |
| R-07 | (descripción pendiente: cotejar con el informe) | sin tanda asignada en los prompts | requiere decisión | Revisar contra el informe de qué trata |
| R-08 | El número del sello con un decimal y coma | R30-02 | hecho | Cualquier oferta evaluada: «7,4/10» |
| R-09 | El número nunca contradice al sello (corte sobre el número redondeado) | R30-02 | hecho | Tests de `packages/pipeline/src/score-display.test.ts` con 4,9, 5, 6,9 y 7 |
| R-10 | Pestañas y chips del listado, textos | R30-05 | parcial | `/jobs`; textos provisorios (PENDIENTE-INFORME R-10 a R-12) |
| R-11 | «Guardada» como marca, pestaña «Guardadas» | R30-03 | hecho | `/jobs?guardadas=1`; requiere la migración 0086 en Neon |
| R-12 | Textos de los chips y del estado vacío, con el glosario | R30-01 y R30-05 | parcial | `/jobs` con filtros que no devuelven nada; texto provisorio |
| R-13 | Tarjeta: puesto, empresa, modalidad y sello | R30-04 | hecho | `/jobs` a 390 px |
| R-14 | Tarjeta: salario solo si el aviso lo publica | R30-04 | hecho | `/jobs`, oferta con y sin sueldo |
| R-15 | Tarjeta: línea «Sin confirmar: …» con hasta 2 cosas | R30-04 | hecho | `/jobs`, oferta evaluada con datos sin confirmar |
| R-16 | Tarjeta: botones «Ver oferta», «Guardar» y «Descartar», sin repeticiones | R30-03 y R30-04 | hecho | `/jobs` |
| R-17 | Contador y estado de las pestañas y de «Guardadas» | R30-03 y R30-05 | hecho | `/jobs`: cada pestaña y el contador |
| R-18 | Chip «Aceptan {tu país}» con regla explícita | R30-05 | hecho | `/jobs` con el chip activo; los avisos sin países no entran |
| R-19 | Chip activo con ×, contador real y «Limpiar filtros» | R30-05 | parcial | `/jobs`, filtros en la URL; el texto del estado vacío es provisorio (PENDIENTE-INFORME R-19) |
| R-20 | Descartadas: fondo neutro y legible | R30-06 | hecho | `/jobs?estado=descartada` |
| R-21 | Descartadas: «Descartada por vos» | R30-06 | hecho | `/jobs?estado=descartada` |
| R-22 | Descartadas: «Volver a revisar» y «Ver oferta» | R30-06 | hecho | `/jobs?estado=descartada` |
| R-23 | Aviso «Oferta descartada. [Deshacer]» | R30-06 | hecho | `/jobs`, descartar una oferta evaluada |
| R-24 | Detalle: orden de las secciones, igual en computadora y celular | R30-08 | hecho | `/jobs/{id}` a 390 y 1280 px |
| R-25 | Detalle en español: «La oferta en pocas palabras» | R31-04 | parcial | `/jobs/{id}` con `JOB_CARD=testers`, de una oferta con ficha (2 o 3 frases con «Así lo dice el aviso»); textos sin cotejar (PENDIENTE-INFORME R-25 a R-29); e2e 383 |
| R-26 | Detalle: bloques «Qué vas a hacer» y «Qué buscan» | R30-08 y R31-04 | parcial | `/jobs/{id}` con ficha: «Qué buscan» separa indispensable y deseable solo si el aviso lo hace; textos sin cotejar |
| R-27 | «Conocé la empresa» | después de abrir | después de abrir | — |
| R-28 | Estados del resumen: preparando, error, sin descripción | R31-04 | hecho | `/jobs/{id}` sin ficha: «Preparando el resumen…», error con «Reintentar», «Pegá la descripción para ver el resumen» y el tope; e2e 370 a 374 y 383 |
| R-29 | «Ver descripción original» a un toque | R31-04 | hecho | `/jobs/{id}`: sigue a un toque, sin traducción completa |
| R-30 | «Lo importante para decidir»: siempre las 7 filas | R30-08 | hecho | `/jobs/{id}`: 7 filas, «No especificado» cuando falta |
| R-31 | Preparar mi postulación: una sola sección | R30-10 | hecho | `/jobs/{id}`, sección plegable |
| R-32 | Un solo botón de salida «Ir a postularme en {sitio}» | R30-10 | parcial | `/jobs/{id}`; la ruta `/jobs/{id}/postular` conserva su botón «Ir al aviso» hasta la R34 |
| R-33 | Botón de salida arriba y fijo en el celular | R30-10 | parcial | `/jobs/{id}` a 390 y 360 px; falta la prueba e2e en esos anchos |
| R-34 | Borradores del formulario que marcan los huecos | R30-10 | parcial | `/jobs/{id}`, formulario; el comportamiento existente no se cambió |
| R-35 | La pregunta al volver; nada se marca solo | R30-10 | hecho | `/jobs/{id}`: «¿Pudiste postularte?» al volver |
| R-36 | CV desde la oferta: revisar mi CV para esta oferta | R34-02 | pendiente | `/jobs/{id}`, «Preparar mi postulación» (hoy solo un enlace) |
| R-37 | CV desde la oferta: adaptar a esta oferta | R34-02 | pendiente | `/jobs/{id}`, «Preparar mi postulación» |
| R-38 | CV desde la oferta: elegir la versión y descargarla | R34-02 | pendiente | `/jobs/{id}`, «Preparar mi postulación» |

## Parte 2 · Evaluación y postulación (S-01 a S-49)

| ID | De qué trata | Tanda | Estado | Cómo verlo |
|---|---|---|---|---|
| S-01 | Sello y aclaración fija de la evaluación | R30-02 | hecho | `/jobs/{id}` evaluada: aclaración fuera del bloque plegable |
| S-02 | Una sola tabla de requisitos a la vista | R30-09 y R31-05 | hecho | `/jobs/{id}`, «Requisitos», con las filas del aviso (`req:<n>`) y su cita cuando hay ficha |
| S-03 | Todo lo demás se deriva de la tabla | R30-09 | hecho | Conteos, «Cómo encaja» y la tarjeta salen de `summarizeRequirements` |
| S-04 | Lenguaje de los estados: Coincide, Sin confirmar, No coincide | R30-01 y R30-09 | hecho | `/jobs/{id}`, «Requisitos» |
| S-05 | «Sin confirmar» no es «No coincide» | R30-01, R30-09 y R31-05 | hecho | `/jobs/{id}`, «Requisitos»: una fila sin dato del perfil dice «Sin confirmar» y ofrece «¿Tenés esto?» (Sí, No, En parte); «No» pasa a «No coincide» y vale para otras ofertas que pidan lo mismo; e2e 378 |
| S-06 | Requisitos del aviso en la tabla, con su fuente | R30-09 y R31-05 | hecho | `/jobs/{id}`, «Requisitos»: filas del aviso con «Así lo dice el aviso» |
| S-07 | Textos de la tabla de requisitos | R30-09 y R31-05 | parcial | `/jobs/{id}`, «Requisitos»; textos de la pregunta sin cotejar (PENDIENTE-INFORME S-02) |
| S-08 | Condición excluyente explicada aparte de la afinidad | R30-09 y R31-06 | parcial | `/jobs/{id}` con una condición que no coincide; `evaluate_job@v1.5.0` está escrita y probada con el modelo simulado, pero no se midió ni se promovió (ver `docs/beta/pasos-manuales-r31.md` §4 y §7) |
| S-09 | Contradicciones entre paneles (bloqueadores y puntaje) | R30-09 | hecho | `/jobs/{id}`: ya no hay panel de bloqueadores aparte de la tabla |
| S-10 | Contradicciones entre paneles (gaps y riesgos) | R30-09 | hecho | `/jobs/{id}`: riesgos dentro de «Cómo se calculó» |
| S-11 | Frases que predicen, fuera (regla 2) | R30-01 | hecho | Test del glosario |
| S-12 | Lenguaje de la tabla con el glosario | R30-01, R30-09 y R31-06 | parcial | `/jobs/{id}`; la tabla de la revisora «tal cual» está sin cotejar; el prompt nuevo no se promovió |
| S-13 | Autorización de trabajo y residencia en filas distintas | R30-09 | hecho | `/jobs/{id}`, «Requisitos» |
| S-14 | El inglés, una sola vez | R30-09 | hecho | `/jobs/{id}`, «Requisitos» |
| S-15 | Parser de sueldo: rangos en USD con punto de miles y variantes | R30-13 | parcial | Tests de `packages/pipeline/src/salary-text.test.ts`; falta conectarlo a una fuente |
| S-16 | Antes de evaluar: «Sin evaluar» y estimación provisoria plegada | R30-02 y R30-08 | hecho | `/jobs/{id}` sin evaluar |
| S-17 | «Evaluar esta oferta» como acción principal sin evaluar | R30-08 | parcial | `/jobs/{id}` sin evaluar; frases del veredicto sin cotejar (PENDIENTE-INFORME S-17) |
| S-18 | «Esto mismo te pasa en N de tus M ofertas» | R31-08 | hecho | `/jobs/{id}` con `JOB_CARD=testers` y un faltante repetido (por ejemplo el inglés): frase junto a «lo que más pesa» y botón que abre solo ese campo; al guardar, las ofertas se actualizan sin llamar al modelo; e2e 382 |
| S-19 | «Cómo encaja»: veredicto y hasta 3 cosas que más pesan | R30-08 | parcial | `/jobs/{id}` evaluada; rótulos de las 7 filas sin cotejar (PENDIENTE-INFORME S-19) |
| S-20 | Secciones plegables iguales en computadora y celular | R30-08 | hecho | `/jobs/{id}` a 390 y 1280 px |
| S-21 | Habilidades ligadas al puesto, «Mencionada en el aviso» | R30-09, R31-05 y R31-07 | hecho | `/jobs/{id}`, «Habilidades»: con ficha, solo las que la ficha liga al puesto; sin ficha, como en la R30 |
| S-22 | El área del puesto es un dato del aviso, no un requisito | R30-09, R31-05 y R31-06 | parcial | Con ficha, la fila «disciplina» ya no figura como requisito cumplido (solo si es un oficio distinto, que es una condición del aviso); el prompt nuevo lo pide pero no está promovido |
| S-23 | Habilidades: nivel de la persona o «Sin cargar» | R30-09 y R31-05 | hecho | `/jobs/{id}`, «Habilidades» |
| S-24 | Habilidades: sin «cobertura 100 %» ni «+6» | R30-09 y R31-05 | hecho | `/jobs/{id}`, «Habilidades» |
| S-25 | Habilidades: sin la lista duplicada de «Sin nivel cargado» | R30-09 y R31-05 | hecho | `/jobs/{id}`, «Habilidades» |
| S-26 | Términos técnicos con ⓘ | R30-09 | parcial | `/jobs/{id}`; cotejar qué términos pide la revisora |
| S-27 | Ajustes del puntaje explicados | R30-09 | parcial | `/jobs/{id}`, «Cómo se calculó» |
| S-28 | Estimación provisoria explicada | R30-09 | parcial | `/jobs/{id}` sin evaluar |
| S-29 | Condición excluyente explicada con ⓘ | R30-09 | parcial | `/jobs/{id}` |
| S-30 | Tabla de lenguaje, tal cual | R30-09 | parcial | `/jobs/{id}`; sin cotejar con el informe |
| S-31 | Palabras prohibidas en la interfaz (match, skills, compatibilidad) | R30-01 y R30-09 | hecho | Test del glosario sobre los textos y los emails |
| S-32 | «Te falta» y «no cumple» junto a un dato que el perfil no tiene | R30-01 y R30-09 | hecho | Test del glosario y `estadoRequisitoVisible` |
| S-33 | Tokens de tamaño de texto | R30-12 | hecho | `apps/web/app/globals.css` y `docs/ux/legibilidad.md` |
| S-34 | Tokens de color de texto | R30-12 | hecho | `apps/web/app/globals.css` y `docs/ux/legibilidad.md` |
| S-35 | Nada debajo de 12 px | R30-12 | hecho | `apps/web/test/legibilidad.test.ts` (las pantallas de ofertas sin excepciones) |
| S-36 | Sin transparencias en textos | R30-12 | hecho | `apps/web/test/legibilidad.test.ts` |
| S-37 | Sellos y chips a 12 px o más | R30-12 | hecho | `/jobs` y `/jobs/{id}` |
| S-38 | Lo necesario para decidir, no en el gris más claro | R30-12 | parcial | La tarjeta pasó a 14 px; falta la revisión de diseño con la auditoría |
| S-39 | Ejemplos de campos vacíos distinguibles de lo cargado | R30-12 | parcial | Regla escrita en `docs/ux/legibilidad.md`; se aplica a los formularios en la R33 y la R34 |
| S-40 | Script de auditoría en claro y oscuro | R30-12 | hecho (falta revisión de diseño) | `apps/web/e2e/340-auditoria-legibilidad.spec.ts` con `AUDITORIA=1`: 0 hallazgos en las pantallas de ofertas |
| S-41 | Auditoría a 390 y 1280 px | R30-12 | hecho (falta revisión de diseño) | Capturas y resumen fuera del repo, para la revisión de diseño |
| S-42 | Auditoría con zoom al 200 % | R30-12 | hecho (falta revisión de diseño) | Emulado con la mitad del ancho de ventana; 0 desbordes |
| S-43 | «¿Te sirve esta evaluación?»: «Sí» solo dice «Gracias» | R30-11 | parcial | `/jobs/{id}` evaluada; motivos sin cotejar (PENDIENTE-INFORME S-43) |
| S-44 | «¿Te sirve esta evaluación?»: motivos del «No» | R30-11 | parcial | `/jobs/{id}` evaluada |
| S-45 | «Proponer otro puntaje» solo para testers y admins | R30-11 | parcial | `/jobs/{id}` con cuenta tester; aclaración sin cotejar (PENDIENTE-INFORME S-45) |
| S-46 | Preparar mi postulación: formulario | R30-10 | hecho | `/jobs/{id}`, sección plegable |
| S-47 | Preparar mi postulación: pasos finales | R30-10 | hecho | `/jobs/{id}`, hasta 5 pasos |
| S-48 | Preparar mi postulación: se elimina «Ver detalle completo» | R30-10 | hecho | `/jobs/{id}`; no existía en esta pantalla |
| S-49 | Preparar mi postulación: aviso de We Work Remotely solo si está confirmado | R30-10 | hecho | `/jobs/{id}` de una oferta de esa fuente: el aviso no sale salvo que la fuente lo confirme (hoy ninguna); e2e 45 |

## Parte 3 · CV y mercado (C-01 a C-72)

| ID | De qué trata | Tanda | Estado | Cómo verlo |
|---|---|---|---|---|
| C-01 | Pantalla «Tu CV»: sin nada cargado | R33-01 | pendiente | `/cv` |
| C-02 | Pantalla «Tu CV»: con datos parciales | R33-01 | pendiente | `/cv` |
| C-03 | Borrador automático | R33-02 | pendiente | `/cv/armar` y `/cv/coach` |
| C-04 | Pantalla «Tu CV»: CV completo con diagnóstico y descarga | R33-01 | pendiente | `/cv` |
| C-05 | Borrador: texto, 30 días y borrado con la cuenta | R33-02 | pendiente | `/cv` con borrador |
| C-06 | Asistente: un solo «Responder y seguir» | R33-03 | pendiente | `/cv/armar` y `/cv/coach` |
| C-07 | Asistente: «Saltear esta pregunta» | R33-03 | pendiente | `/cv/armar` y `/cv/coach` |
| C-08 | Asistente: «Terminar y armar» con confirmación | R33-03 | pendiente | `/cv/armar` y `/cv/coach` |
| C-09 | Asistente: el dictado no envía solo | R33-03 | pendiente | `/cv/armar` |
| C-10 | Asistente: avance como lista de los 7 temas | R33-03 | pendiente | `/cv/armar` y `/cv/coach` |
| C-11 | Asistente: «Volver a la pregunta anterior» | R33-03 | pendiente | `/cv/armar` y `/cv/coach` |
| C-12 | Asistente: privacidad una sola vez, en un ⓘ | R33-03 | pendiente | `/cv/armar` y `/cv/coach` |
| C-13 | Asistente: mensaje de honestidad corto y arriba | R33-03 | pendiente | `/cv/armar` y `/cv/coach` |
| C-14 | Asistente: camino para quien no tiene experiencia | R33-03 | pendiente | `/cv/armar` |
| C-15 | Resumen profesional: preguntas | R33-04 | pendiente | `/cv/armar` |
| C-16 | Resumen profesional: borrador editable | R33-04 | pendiente | `/cv/armar` |
| C-17 | Resumen profesional: sin cifras inventadas | R33-04 | pendiente | Tests de `packages/pipeline` |
| C-18 | Habilidades blandas por situaciones | R33-04 | pendiente | `/cv/armar` |
| C-19 | Habilidades blandas: de dónde salió cada una | R33-04 | pendiente | `/cv/armar` |
| C-20 | Habilidades blandas: entre 2 y 4 como máximo | R33-04 | pendiente | `/cv/armar` |
| C-21 | Sugerencias por rubro con lista curada | después de abrir | después de abrir | — |
| C-22 | Sugerencias por rubro con lista curada | después de abrir | después de abrir | — |
| C-23 | Sugerencias por rubro con lista curada | después de abrir | después de abrir | — |
| C-24 | Sugerencias por rubro con lista curada | después de abrir | después de abrir | — |
| C-25 | Sugerencias por rubro con lista curada | después de abrir | después de abrir | — |
| C-26 | «Esto es lo que entendí»: ejemplos de guía distinguibles | R33-05 | pendiente | `/cv` revisión |
| C-27 | «Esto es lo que entendí»: «Quitar trabajo» con confirmación y «Deshacer» | R33-05 | pendiente | `/cv` revisión |
| C-28 | «Esto es lo que entendí»: «Agregar otro trabajo» | R33-05 | pendiente | `/cv` revisión |
| C-29 | «Esto es lo que entendí»: «Agregar estudio o certificación» | R33-05 | pendiente | `/cv` revisión |
| C-30 | «Esto es lo que entendí»: habilidades con selector, chips y texto libre | R33-05 | pendiente | `/cv` revisión |
| C-31 | «Esto es lo que entendí»: idiomas con el nivel explicado | R33-05 | pendiente | `/cv` revisión |
| C-32 | «Esto es lo que entendí»: varios idiomas | R33-05 | pendiente | `/cv` revisión |
| C-33 | «Esto es lo que entendí»: campos de resumen y blandas | R33-05 | pendiente | `/cv` revisión |
| C-34 | «Esto es lo que entendí»: links | R33-05 | pendiente | `/cv` revisión |
| C-35 | «Esto es lo que entendí»: cierre «Guardar y ver mi CV» | R33-05 | pendiente | `/cv` revisión |
| C-36 | Diagnóstico: palabra y número entero | R33-06 | pendiente | `/cv` diagnóstico |
| C-37 | Diagnóstico: cortes de los niveles | R33-06 | pendiente | Tests de `cv-diagnosis.ts` |
| C-38 | Diagnóstico: frase fija sobre qué miden los niveles | R33-06 | pendiente | `/cv` diagnóstico |
| C-39 | Diagnóstico: cada barra dice qué mide, con ⓘ | R33-06 | pendiente | `/cv` diagnóstico |
| C-40 | Diagnóstico: «Legibilidad» y «Largo» separados | R33-06 | pendiente | `/cv` diagnóstico |
| C-41 | Diagnóstico: cada faltante con su botón al paso concreto | R33-06 | pendiente | `/cv` diagnóstico |
| C-42 | Diagnóstico: una sola acción principal si varias barras fallan por lo mismo | R33-06 | pendiente | `/cv` diagnóstico |
| C-43 | Contacto: LinkedIn, portfolio y GitHub marcados si están cargados | R33-07 | pendiente | `/cv` vista previa |
| C-44 | Contacto: ciudad y país marcados | R33-07 | pendiente | `/cv` vista previa |
| C-45 | Contacto: excepción a lo que se marca solo | R33-07 | pendiente | `/cv` vista previa |
| C-46 | Links: URL completa, validación de https y «Abrir para probarlo» | R33-07 | pendiente | `/cv` vista previa |
| C-47 | Aviso antes de descargar un CV incompleto; títulos en un solo idioma | R33-07 | pendiente | `/cv` descarga |
| C-48 | PDF real generado en el servidor | R33-08 | pendiente | `/cv` descarga |
| C-49 | PDF: «Descargar PDF» y nombre del archivo | R33-08 | pendiente | `/cv` descarga |
| C-50 | PDF: A4 y texto seleccionable | R33-08 | pendiente | `/cv` descarga |
| C-51 | PDF: acentos y eñes | R33-08 | pendiente | `/cv` descarga |
| C-52 | PDF: links tocables | R33-08 | pendiente | `/cv` descarga |
| C-53 | PDF igual a la vista previa, con carga y error | R33-08 | pendiente | `/cv` descarga |
| C-54 | PDF: sesión, rate limit y sin URL pública | R33-08 | pendiente | Tests de la ruta de descarga |
| C-55 | PDF: pruebas del informe | R33-08 | pendiente | Tests de `packages/pipeline` y e2e |
| C-56 | Calidad del CV: titular con puesto y resumen arriba | R33-09 | pendiente | `/cv` vista previa |
| C-57 | Calidad del CV: «Actualidad» si el trabajo sigue | R33-09 | pendiente | `/cv` vista previa |
| C-58 | Calidad del CV: de tareas a logros sin inventar | R33-09 | pendiente | `/cv/armar` |
| C-59 | Calidad del CV: antes y después conservando las palabras de la persona | R33-09 | pendiente | `/cv/armar` |
| C-60 | Calidad del CV: categorías de habilidades según el rubro | R33-09 | pendiente | `/cv` vista previa |
| C-61 | Calidad del CV: «Habilidades» en español | R33-09 | pendiente | `/cv` vista previa |
| C-62 | Calidad del CV: aviso suave si una habilidad no aparece en ninguna viñeta | R33-09 | pendiente | `/cv` diagnóstico |
| C-63 | Forma del cargo | después de abrir | después de abrir | — |
| C-64 | Calidad del CV: aviso si falta Educación | R33-09 | pendiente | `/cv` diagnóstico |
| C-65 | Calidad del CV: idioma con su nivel explicado | R33-09 | pendiente | `/cv` revisión |
| C-66 | Calidad del CV: nunca un dato no confirmado | R33-09 | pendiente | `/cv` vista previa |
| C-67 | Calidad del CV: «Español: nativo» no se asume | R33-09 | pendiente | `/cv` vista previa |
| C-68 | Calidad del CV: lo que está vacío queda vacío | R33-09 | pendiente | `/cv` vista previa |
| C-69 | Calidad del CV: ninguna sugerencia entra sin que la marque | R33-09 | pendiente | `/cv/armar` |
| C-70 | `/market` mínimo: preguntas para la carrera de la persona | R34-03 | pendiente | `/market` |
| C-71 | `/market` mínimo: cada dato con su cantidad de avisos y fecha | R34-03 | pendiente | `/market` |
| C-72 | `/market` mínimo: pocos datos sin gráfico y una acción por bloque | R34-03 | pendiente | `/market` |
