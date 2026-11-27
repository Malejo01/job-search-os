# Verificación del informe de revisión, punto por punto

Una fila por cada uno de los 159 puntos del informe de revisión: **R-01 a R-38** (listado y detalle de la oferta), **S-01 a S-49** (evaluación y postulación) y **C-01 a C-72** (CV y mercado). La crea la R30 y la actualiza cada tanda de la cadena R30 a R34 (`docs/beta/cadena-r30-r34.md` §3).

- **Estados:** `hecho`, `parcial`, `pendiente`, `después de abrir` y `requiere decisión`.
- **Tanda:** el ticket que lo cubre, según `docs/beta/prompt-r30.md` a `prompt-r34.md`. Los que el plan deja para después (`docs/beta/plan-r30-r34.md` §12) llevan «después de abrir».
- **Cómo verlo:** la pantalla o el comando donde se comprueba.
- **Sobre las descripciones:** el informe original es privado y no va al repo. Cada descripción es una línea armada con lo que el plan y los tickets dicen de ese ID; no copia texto del informe. Si una fila no coincide con lo que dice el informe, vale el informe: corregir acá.

> Textos sin cotejar con el informe original: ver PENDIENTE-INFORME en `apps/web/lib/textos-rediseno.ts`. Las filas con «(descripción pendiente: cotejar con el informe)» no tienen su descripción en el plan ni en los prompts.

Estado al cierre de la R31 (26/11): se actualizaron las filas R-02, R-25 a R-29, S-02, S-05 a S-08, S-12, S-18, S-21 y S-22. Lo de la R31 solo se ve con `JOB_CARD=testers` (apagada, la app es la de la R30) y necesita las migraciones 0087 y 0088 y las RLS 0071 a 0073 aplicadas (`docs/beta/pasos-manuales-r31.md`). Las filas que dependen de `evaluate_job@v1.5.0` quedan `parcial` hasta medirla y promoverla.

Estado al cierre de la R33 (26/11): se actualizaron C-01 a C-05, C-26 a C-47 en lo que cubren R33-05 y R33-06 (ver abajo) y C-43 a C-69 en lo de R33-07 a R33-09. **Las descripciones de C-43 a C-69 se corrigieron para que coincidan con el informe de revisión** (la versión anterior las había armado a partir del plan y no coincidían). Las filas C-06 a C-20 (R33-03 y R33-04) y los e2e de la tanda **(completa el lead)**. Lo de la tanda necesita la migración 0091 y la RLS 0075 aplicadas (`docs/beta/pasos-manuales-r33.md`). C-21 a C-25 y C-63 quedan «después de abrir». Ver `docs/beta/informe-r33.md`.

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
| C-01 | Diagnóstico de intención: «No tengo CV» es la puerta cuando no hay nada; la mini-tarjeta, el recordatorio cuando ya hay algo | R33-01 | hecho, con una diferencia | `/cv` sin datos: solo «Tengo CV» y «No tengo CV» (e2e 428); con algo cargado la puerta desaparece y queda el recordatorio de lo que falta. Diferencia: sin el agente de perfil no hay puerta de dos caminos, y ahí la lista de faltantes también se muestra con el CV vacío (es la guía) |
| C-02 | Regla de visibilidad según el estado de los datos (sin nada / parcial / completo) | R33-01 | hecho | La regla es `cvScreen` en `packages/pipeline` (13 tests). Parcial: sin «No tengo CV», con «Seguir armando mi CV» y la lista de lo que falta, cada ítem con su botón (e2e 428). Completo: diagnóstico y descarga, y la tarjeta de pendientes desaparece (solo test unitario: exige un resumen confirmado). Un borrador sin confirmar no cambia el estado: solo suma el aviso |
| C-03 | Borrador automático | R33-02 | parcial | `/cv/armar` y `/cv/perfil` → coach: dejar a medias y volver. Requiere 0091 y RLS 0075 en Neon; e2e 410 (sin correr) |
| C-04 | Enlaces genéricos reemplazados por botones a campos concretos: «Agregar mi experiencia», «Agregar mis estudios», «Escribir mi resumen» | R33-01 | hecho, con una diferencia | `/cv`, lista de lo que falta (e2e 428): experiencia y estudios caen en el campo exacto de `/settings/historial` (`?tipo=` y ancla), habilidades e idioma en `/settings/skills`. Diferencia: «Escribir mi resumen» lleva al asistente (`/cv/armar`), porque no hay otro lugar donde escribirlo; sin el chat dice «Todavía no hay dónde escribirlo». «Skills» se escribe «habilidades» (glosario) |
| C-05 | Borrador: texto, 30 días y borrado con la cuenta | R33-02 | parcial | Tests de integración (vencimiento a 30 días y cascada con la cuenta). «Volver a Tu CV» dice «Tu progreso queda guardado como borrador» en el chat y en el coach (el borrador se guarda solo, así que no hay aviso de salida). La purga no está programada (`pasos-manuales-r33.md` §3) |
| C-06 | Asistente: un solo «Responder y seguir» | R33-03 | hecho | `/cv/armar` y `/cv/coach/charla`; e2e 411 y 413 (sin correr) |
| C-07 | Asistente: «Saltear esta pregunta» | R33-03 | hecho | Enlace con «Podés volver a esto más tarde». En el chat lo salteado queda en la lista de temas con «Volver a este tema» (`guided.test.ts`); en el coach queda marcado y se retoma en la próxima revisión |
| C-08 | Asistente: «Terminar y armar» con confirmación | R33-03 | hecho, con una diferencia | Chat: solo con datos suficientes (un trabajo con empresa y cargo, proyecto, estudio o certificación), aparte, con «Falta: […]». Coach: el CV ya existe, así que siempre está disponible y pide confirmación mientras la revisión no terminó |
| C-09 | Asistente: el dictado no envía solo | R33-03 | hecho | «Revisá lo que dijimos y apretá Responder y seguir» tras dictar, en el chat y en el coach. El dictado siempre solo completó el campo |
| C-10 | Asistente: avance como lista de los 7 temas | R33-03 | hecho, con una diferencia | Chat: los 7 temas (puesto, resumen, experiencia, estudios, habilidades, idiomas, links; el séptimo es el resumen y estudios con certificaciones cuentan como uno). Coach: la lista son los problemas de la revisión de ese CV, no los 7 temas |
| C-11 | Asistente: «Volver a la pregunta anterior» | R33-03 | hecho | `/cv/armar` y `/cv/coach/charla` (e2e 411 y 413, sin correr). En el coach, lo ya confirmado en tarjetas no se deshace |
| C-12 | Asistente: privacidad una sola vez, en un ⓘ | R33-03 | hecho | `VoiceInput` con `privacy="info"` (nuevo); la revisión («Dictar tareas») usa `hidden` salvo el primero, a cargo de `calidad` |
| C-13 | Asistente: mensaje de honestidad corto y arriba | R33-03 | hecho, con una diferencia | Dice «Nada entra a tu CV hasta que lo confirmes» en vez de «Nada se guarda hasta que lo confirmes» (el plan §11 guarda un borrador; ver C-03). A confirmar con la revisora |
| C-14 | Asistente: camino para quien no tiene experiencia | R33-03 | hecho | `/cv/armar`: la pregunta de estudios ofrece proyectos, voluntariado y cursos. El coach parte de un CV ya cargado |
| C-15 | Resumen profesional: preguntas | R33-04 | hecho | `/cv/armar`: tres preguntas tras el puesto (la del puesto ya existía y no se repite si el perfil ya lo tiene) |
| C-16 | Resumen profesional: borrador editable | R33-04 | hecho, con una diferencia | El borrador de 2 o 3 frases lo arma el código con las palabras de la persona, no la IA (USD 0, sin prompt nuevo); queda un gancho validado para una IA (`cvSummaryChoose`). Campo editable «Resumen profesional» en la revisión |
| C-17 | Resumen profesional: sin cifras inventadas | R33-04 | hecho | `guided.test.ts` (validador: cifras, números en letras, nombres, tecnologías y links que no estén en las respuestas); un solo bloque, sin «Objetivo» |
| C-18 | Habilidades blandas por situaciones | R33-04 | hecho | `/cv/armar`: cuatro situaciones con el texto del informe; nunca «¿cuáles son tus habilidades blandas?». La habilidad de cada situación sale de una tabla fija |
| C-19 | Habilidades blandas: de dónde salió cada una | R33-04 | hecho | «La sugerimos por lo que contaste en {empresa}», la viñeta que se sumaría, «Usarla» / «No, gracias». Sin ejemplo no se propone nada |
| C-20 | Habilidades blandas: entre 2 y 4 como máximo | R33-04 | hecho | Tope de 4 contando lo usado (`guided.test.ts`); con una sola situación contada se muestran 1 o 2 |
| C-21 | Sugerencias por rubro con lista curada | después de abrir | después de abrir | — |
| C-22 | Sugerencias por rubro con lista curada | después de abrir | después de abrir | — |
| C-23 | Sugerencias por rubro con lista curada | después de abrir | después de abrir | — |
| C-24 | Sugerencias por rubro con lista curada | después de abrir | después de abrir | — |
| C-25 | Sugerencias por rubro con lista curada | después de abrir | después de abrir | — |
| C-26 | Campos vacíos con texto de ejemplo que se confunde con lo cargado: placeholder con contraste y «Sin completar» | R33-05 | hecho | `/cv/armar` (revisión) y tarjetas de `/cv/perfil`: ejemplos «Ejemplo: …» en gris y el estado «Sin completar»; e2e 430 (sin correr) |
| C-27 | «Quitar trabajo» pegado a «Logro»: separarlo y pedir confirmación («¿Quitar este trabajo? [Quitar] [Cancelar]»), con «Deshacer» | R33-05 | hecho, con una diferencia | `/cv/armar`, revisión; e2e 430. El texto agrega el número del trabajo: «¿Quitar este trabajo? (1)». En el coach no hay «Quitar»: «Descartar» ya es un interruptor reversible y no borra nada hasta «Guardar lo que elegí» |
| C-28 | Botón claro «Agregar otro trabajo» | R33-05 | hecho | `/cv/armar` (tope de 6 trabajos) y tarjetas de `/cv/perfil` |
| C-29 | «Estudios y certificaciones: Nada cargado» → botón «Agregar estudio o certificación» | R33-05 | hecho, con una diferencia | `/cv/armar` (con «Tipo»: estudio o certificación). En el coach la tarjeta nueva es de estudio, certificación incluida (no hay tarjeta de certificación) |
| C-30 | Habilidades: selector con sugerencias para marcar + campo libre, con chips que se quitan | R33-05 | parcial | `/cv/armar`: chips y campo libre (Enter o «Agregar habilidad»). El selector existe y lleva «Sugerencia: verificá que corresponda a tu caso», pero no recibe sugerencias (por rubro: después de abrir). En el coach, cada habilidad ya es una tarjeta con su nivel |
| C-31 | «Idiomas: Inglés A2»: nivel con explicación («A2: básico») y poder cargar más idiomas con su nivel | R33-05 | hecho, con una diferencia | `/cv/armar`: selector de nivel explicado (A1 a C2 y Nativo) y «Agregar otro idioma» (hasta 6). En el coach el nivel también se explica, pero no hay «Agregar otro idioma» (las tarjetas salen del CV leído) |
| C-32 | Campos nuevos: Resumen (C-16), habilidades blandas confirmadas (C-19) y Links (C-45) | R33-05 | parcial | `/cv/armar`: resumen editable y blandas con «Usarla» / «No, gracias» (paneles de `asistente`, arriba de la revisión) y links de LinkedIn, GitHub y portfolio (solo `https`). En el coach no hay estos campos en las tarjetas: los links se cargan en `/cv` (R33-07) |
| C-33 | «Dictar tareas 1»: el aviso de privacidad se muestra una sola vez (C-12) | R33-05 | hecho | `/cv/armar`, revisión: el primer «Dictar tareas» lleva el aviso en el ⓘ (`privacy="info"`) y los demás no (`hidden`) |
| C-34 | Botón de cierre claro «Guardar y ver mi CV»; aclarar cuándo se guarda | R33-05 | hecho, con una diferencia | `/cv/armar`, vista previa: el botón y, encima, «Nada entra a tu CV hasta que toques «Guardar y ver mi CV»». Diferencia con el informe, que pide aclarar que se guarda recién con ese botón: vale el plan §11, que guarda un borrador mientras la persona avanza; lo que recién entonces ocurre es que entre al CV. En el coach el guardado es por tarjeta («Guardar lo que elegí») |
| C-35 | Mantener «Si algo está vacío, queda vacío: no lo completo yo» | R33-05 | hecho | `/cv/armar`, revisión: el texto está tal cual. En el coach, «lo que el CV no dice queda vacío» |
| C-36 | Escala de palabras con número entero: 8 a 10 «Sólido», 5 a 7 «En camino», 1 a 4 «Para reforzar», 0 «Sin empezar» | R33-06 | hecho | `/cv` diagnóstico; 44 tests de `cv-diagnosis.ts` con los bordes (el número se redondea primero y la palabra sale del entero que se ve); e2e 429 (sin correr). Un 0 con contenido cargado dice «Para reforzar · 0/10» (con «Sin empezar» diría que no hay nada cargado) |
| C-37 | Frase fija: «Estos niveles miden cómo lo lee un sistema automático. No miden si sos buen o buena candidata» | R33-06 | hecho | `/cv` diagnóstico, arriba, con la leyenda de las cuatro palabras |
| C-38 | Cada barra con una línea que diga qué mide, y un «ⓘ» | R33-06 | hecho | `/cv` diagnóstico: el ⓘ abre «Qué mide» con el texto de cada barra (por teclado también) |
| C-39 | Separar «Legibilidad» de «Largo/contenido» en dos barras | R33-06 | hecho | `/cv` diagnóstico: seis barras |
| C-40 | Si varios «Falta» tienen el mismo motivo (sin experiencia), una acción principal y el resto en pausa; y cada «falta» con un paso concreto (tabla 8.2) | R33-06 | parcial | `/cv` diagnóstico sin experiencia: «Cargá tu experiencia laboral» + «Agregar mi experiencia», y «Se calcula cuando tengas experiencia cargada» en legibilidad, largo y logros. Cada barra trae su botón (titular, contacto, resumen, estudios, «Escribir un logro con ayuda»…). Falta: «La tengo / No la tengo» por habilidad, con nivel; hoy el botón lleva a `/settings/skills` |
| C-41 | Mantener «Sumalas solo si de verdad las tenés» y que el diseño no empuje a agregar lo que no se tiene | R33-06 | hecho | `/cv` diagnóstico: el consejo de palabras clave conserva la frase |
| C-42 | Los «Falta» de logros y de largo contemplan que ya hay experiencia con viñetas vagas: el paso es reescribirlas con preguntas | R33-06 | hecho | `/cv` diagnóstico: con experiencia cargada, logros dice «Escribir un logro con ayuda» (no «cargá experiencia»); test «viñetas vagas» |
| C-43 | Vista previa que se actualiza sola al cambiar las opciones | R33-07 | hecho | `/cv`: cambiar el idioma o una casilla; sin botón «Actualizar vista previa»; e2e 421 |
| C-44 | Opciones del contenido: teléfono (opcional, sin marcar), ciudad y país («no tu dirección»), links | R33-07 | hecho | `/cv`, opciones del CV y «Tus links»: el teléfono se guarda en `application_settings.links` (sin migración), validado (dígitos, espacios, `+ - ( )`, 6 a 15 dígitos) y sale en el CV solo si se marca «Incluir mi teléfono»; en la URL viaja la marca `tel=1`, nunca el número; no se le pasa al modelo en el contexto de postulaciones. e2e 421. **Diferencia aceptada:** la casilla «Incluir skills básicas» se llama «Incluir habilidades básicas» (glosario) |
| C-45 | Links: URL completa como texto, solo `https`, «Abrir para probarlo»; ¿el tema links del asistente se guarda? | R33-07 | hecho | `/cv`, «Tus links»: LinkedIn, GitHub, «Portfolio o sitio web» y «Otro link» con un nombre corto (por ejemplo, Behance), cada uno con su casilla «Incluir mi …», `https` obligatorio y «Abrir para probarlo». Los links del chat se guardan (`asistente`, R33-04). e2e 421 |
| C-46 | Aviso antes de descargar un CV incompleto («¿Completarlo antes?») | R33-07 | hecho | `/cv`: «Descargar PDF» o «Descargar DOCX» con un CV sin Educación o sin Resumen; e2e 421 |
| C-47 | Títulos de las secciones en un solo idioma («Habilidades») | R33-07 | hecho | `/cv` en español y en English; tests de `quality.test.ts` |
| C-48 | Botones coherentes («Descargar DOCX» y «Descargar PDF», un archivo real) | R33-08 | hecho | `/cv`; e2e 420 |
| C-49 | El archivo descargado coincide con la vista previa | R33-08 | hecho | Mismas opciones en la URL de la vista previa y de las dos descargas; e2e 421 |
| C-50 | PDF con texto seleccionable; DOCX que abre en tres programas | R33-08 | parcial | Texto seleccionable probado en `pdf.test.ts`; la apertura en lectores reales es manual (`pasos-manuales-r33.md` §5) |
| C-51 | Nombre del archivo `CV-Nombre-Apellido.pdf` | R33-08 | hecho | Descargar el PDF; e2e 420 |
| C-52 | A4, márgenes legibles, sin cortar una viñeta entre páginas | R33-08 | hecho | `packages/pipeline/src/cv-out/pdf.test.ts`; impresión en papel manual |
| C-53 | Tildes, eñes, nombres y emails largos | R33-08 | hecho | `pdf.test.ts`; lo que no entra en WinAnsi se reemplaza y se informa |
| C-54 | Estados «Generando tu archivo…» y de error con el siguiente paso | R33-08 | hecho | `/cv`, descarga; error 429 por ritmo. El ritmo es por instancia (limitación en ADR-049) |
| C-55 | Pruebas: vacío, muy corto, dos páginas, links, inglés, tres programas, papel | R33-08 | parcial | Automáticas en `pdf.test.ts`; tres programas y papel, manual |
| C-56 | Titular con el puesto y resumen arriba | R33-09 | parcial | `/cv`: aviso de titular; el resumen lo escribe el asistente (R33-04) |
| C-57 | Viñetas de tareas, no de logros | R33-09 | hecho | `/cv`, «Para que tu CV se lea mejor», con preguntas guía |
| C-58 | Verbo y frase vagos | R33-09 | hecho | Mismo aviso que C-57 |
| C-59 | Falta Educación | R33-09 | hecho | `/cv`: lista de faltantes y aviso antes de descargar |
| C-60 | Categorías de habilidades comprensibles según el perfil | R33-09 | hecho | `/cv`, vista previa; tests de `cvGroupSkills`. Regla heurística: perfil técnico si la mitad o más son técnicas |
| C-61 | Habilidades sin respaldo en la experiencia: aviso suave | R33-09 | hecho | `/cv`, «Para que tu CV se lea mejor»; no se quita ninguna |
| C-62 | «Actualidad» si el trabajo sigue | R33-09 | parcial | `/cv`, vista previa. La pregunta «¿Es tu trabajo actual?» ya está en el chat de `/cv/armar`; en el coach queda para la R34 (necesita un prompt nuevo) |
| C-63 | Forma del cargo | después de abrir | después de abrir | — |
| C-64 | Idioma con su nivel explicado | R33-09 | hecho | `/cv`: «Inglés: A2, nivel básico» |
| C-65 | Sin links | R33-07 | hecho | Mismo editor que C-45 |
| C-66 | Mezcla de idioma en los títulos | R33-07 | hecho | Mismo cambio que C-47 |
| C-67 | Preguntas guía para pasar de tareas a logros sin inventar | R33-09 | hecho | Preguntas con las palabras de la persona; tests de `quality.test.ts` |
| C-68 | Reescritura con «antes» y «después» | R33-09 | parcial | Componente y comparación listos; ninguna pantalla propone hoy la reescritura de una viñeta existente |
| C-69 | No agregar datos no cargados («Español: nativo») | R33-09 | hecho | Tests del modelo; `/cv` sin idiomas que no cargaste |
| C-70 | `/market` mínimo: preguntas para la carrera de la persona | R34-03 | pendiente | `/market` |
| C-71 | `/market` mínimo: cada dato con su cantidad de avisos y fecha | R34-03 | pendiente | `/market` |
| C-72 | `/market` mínimo: pocos datos sin gráfico y una acción por bloque | R34-03 | pendiente | `/market` |
