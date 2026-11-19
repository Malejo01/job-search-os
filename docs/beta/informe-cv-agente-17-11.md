# Informe: el chat de CV es rígido y cómo pasar a «pegá tu CV y te ayudo a mejorarlo» (17/11)

> Copia en el repo del informe que recibió el lead para la R12-0. Se quitaron el empleador, el cargo exacto y los
> nombres de los proyectos de Mauro (regla 8 de `CLAUDE.md`): no cambian el diagnóstico. La verificación contra el
> código y el plan están en [`plan-coach-cv.md`](./plan-coach-cv.md); el ADR, en
> [`docs/adr/038-coach-de-cv.md`](../adr/038-coach-de-cv.md).

Para el equipo de agentes de AfinIAJobs. Sale de la prueba que hizo Mauro el 17/11 en producción, usando «Armá tu CV con IA» como un usuario normal, y de una lectura del código (`main` en `6cace3c`, 13/11, y la rama `ronda/r11-1-agente-perfil-v2`, PR #514).

## 1. Resumen

- **Lo que probó Mauro es el chat de ADR-026 (`/cv/armar`), no el agente de perfil.** El agente de perfil (ADR-034, R10 + R11-1, PR #514) está hecho pero **no está mergeado**: `main` sigue en la integración R8-R9.
- **La rigidez es una decisión de diseño, no un bug.** ADR-026 §3: el código decide el temario, la pregunta es una plantilla fija y el modelo solo extrae la respuesta de **un** tema con un esquema estricto. Todo lo que la persona cuenta fuera de ese tema se pierde en silencio.
- **#514 resuelve la mitad del pedido** (subir el CV, tarjetas por sección, preguntar solo lo que falta). La charla de huecos **sigue con plantillas fijas** y el modelo sigue sin redactar preguntas. No hay sección de **Proyectos** en el CV, y el PDF todavía no se lee.
- **Lo que pide Mauro ahora es una etapa nueva:** que el sistema **lea el CV, lo critique contra el puesto objetivo y el mercado, y repregunte para mejorarlo**. Eso reabre parte de ADR-026 §3 y necesita un ADR nuevo.

## 2. La prueba del 17/11 (transcripción resumida)

| Paso | Qué pasó | Problema |
|---|---|---|
| Puesto | Respuesta larga (AI Engineer + segunda opción Full Stack + modalidad y mercado). «Buenísimo, tomo nota del perfil al que apuntás.» | El acuse es genérico: no dice qué entendió. Además, el puesto ya estaba en el perfil (lo arregla R11-12, #511, sin mergear). |
| Empresa | «[Empresa A]», más cargo, tareas y fechas en el mismo mensaje. «Bárbaro, ya anoté la empresa.» | Se queda solo con la empresa. Después vuelve a pedir el cargo y las fechas, que ya estaban dichos. |
| Cargo | Mauro da el cargo **y cuenta cuatro proyectos con IA** (cuatro proyectos propios, uno de ellos AfinIAJobs). «Buenísimo, tomo nota del cargo.» | **Los proyectos se pierden en silencio.** Para alguien de 2 años de experiencia o que cambia de carrera, es lo más valioso del CV. |
| Cargo (dato) | El cargo quedó cargado de dos formas en distintos pasos. | No contrasta con lo que ya hay en el perfil ni avisa la contradicción. |
| Fechas | Pregunta las fechas, que ya estaban en el mensaje de la empresa (con otro mes de fin). | Repregunta lo dicho y no detecta la diferencia (febrero contra marzo). |
| Tareas | «¿Qué hacías? De una a cuatro.» | Formulario disfrazado de charla. |

**Sensación de usuario:** «demasiado rígido». Siente que habla con un formulario que no escucha.

## 3. Por qué pasa: el código

**Chat de producción (ADR-026, `main`):**

| Archivo | Qué hace | Efecto en la prueba |
|---|---|---|
| `packages/pipeline/src/cv-chat/state.ts` · `nextCvTopic` | Orden fijo: puesto → por trabajo (empresa, cargo, fechas, tareas, logro, ¿otro?) → estudios, certificaciones, skills, idiomas, links. | Pregunta lo mismo a todos y en el mismo orden. |
| `packages/pipeline/src/cv-chat/questions.ts` | La pregunta es una plantilla fija. El modelo no la elige ni la reformula. | No se adapta a lo que la persona ya dijo. |
| `packages/pipeline/src/cv-chat/schemas.ts` | Un `z.strictObject` **por tema**. Ejemplo: `organization` solo acepta `{ organization, noExperience }`. | El cargo, las fechas y los proyectos que vienen en la misma respuesta **no tienen dónde ir** y se descartan. |
| `packages/pipeline/src/cv-out/model.ts` · `CvHistoryKind = "trabajo" \| "educacion" \| "certificacion"` | No existe el tipo «proyecto». | **El CV ATS no tiene sección Proyectos.** Aunque el chat los escuchara, no habría dónde ponerlos. |
| `packages/pipeline/src/cv-chat/follow-up.ts` | Repregunta solo `dates`, `duties` y `achievement`, hasta 2 veces. El modelo propone el texto y el código lo valida. | **Es el único lugar donde el modelo ya redacta una pregunta.** Sirve de patrón para crecer. |
| `apps/web/app/(app)/cv/armar/chat.tsx:191` | «Si tenés un CV hecho, no lo pegues acá: cargá tu historial a mano.» | Justo lo contrario de lo que quiere un usuario con CV. |

**ADR-026, Alternatives**, ya lo anticipaba: «Que el modelo decida qué preguntar» se descartó por auditabilidad, costo e inyección. «Pregunta redactada por el modelo en una segunda llamada» quedó **«como opción si Mauro la prefiere»**. Mauro ahora la prefiere.

## 4. Lo que ya está hecho y no está en producción (#514, ADR-034)

**Sí resuelve:**
- Subir el CV (DOCX leído en el navegador, sin guardar el archivo), con tarjetas por sección para confirmar (experiencia, estudios, skills, idiomas) y guardar en `career_history` con `source='cv'`.
- Charla de huecos: pregunta solo lo que falta, con plantillas **por carrera** (`packages/prompts/profile_gaps.v1.md`), hasta 2 repreguntas, y acepta «no tengo».
- Guía de búsqueda sin modelo (puestos, criterios, palabras de alerta, skills a reforzar desde datos del pool) y cierre con el CV ATS.
- Flag `CV_PROFILE_AGENT=testers`, cupo y topes.

**No resuelve lo que pidió Mauro hoy:**
1. **El PDF no se lee** (ADR-034 §11, depende de `pdfjs-dist`): se le pide a la persona pegar el texto. La mayoría de los CV son PDF.
2. **Los huecos siguen con plantillas fijas.** El modelo no redacta preguntas (ADR-034 §1). Va a sonar parecido a lo que probó Mauro, solo que más corto.
3. **No critica el CV.** «Hueco» es un campo vacío o flojo (fecha, logro en null, tareas vagas). No hay diagnóstico del tipo «tu CV apunta a AI Engineer pero no muestra ningún proyecto con LLMs» o «esta viñeta no tiene resultado».
4. **Los proyectos:** la lectura los detecta (`facts` con `kind: "proyecto"` en `packages/pipeline/src/cv/extraction.ts`), pero **no hay tarjeta ni sección de proyectos en el CV**.
5. **Las tarjetas de lectura salen sin viñetas** (decisión de ADR-034 §2): el CV que entra pierde sus viñetas y hay que volver a dictarlas.
6. **No hay comparación antes/después** del CV original contra el CV mejorado, que es justo lo que Mauro quiere medir.

## 5. Lo que queremos: un «coach de CV»

> La persona pega o sube su CV, dice a qué puesto apunta, y el sistema le dice qué le falta a ese CV para ese puesto, le pregunta solo lo necesario para mejorarlo y le devuelve un CV ATS mejor, mostrando qué cambió.

Reglas que se mantienen (no negociables):
- **El modelo evalúa, el código decide.** El modelo puede **detectar problemas y redactar preguntas**; qué se pregunta, en qué orden y cuándo termina lo decide el código, auditable.
- **El verificador de ADR-026 sigue para todo texto que termine en el CV.** Ningún hecho que la persona no dijo o que no esté en su CV original.
- **No se guarda ni el archivo ni la charla** (ADR-008). Solo lo que la persona confirma.
- **El CV y lo que escribe la persona entran como dato, nunca como instrucción.**
- **Nunca pregunta datos sensibles** (`SENSITIVE_QUESTION_RE` sigue aplicando a toda pregunta, también a las del modelo).

## 6. Arquitectura propuesta (resumen)

Entrada (pegar texto, DOCX, PDF con `pdfjs-dist`) → Lectura (`extract_cv_profile`, con viñetas originales y tarjeta de proyectos) → Diagnóstico (`cv_review`, nuevo: problemas tipados que apuntan a un campo, ordenados y recortados por el código) → Charla de mejora (`cv_coach_turn`, nuevo: una llamada por turno que extrae todo lo útil y propone la siguiente pregunta, validada por el código con plantilla de respaldo) → Cierre (`cv_write` + verificador, con sección Proyectos y vista «qué mejoró»). Modelo de datos: `career_history` suma el tipo `proyecto`. Nada nuevo se guarda de la charla ni del diagnóstico.

## 7. Decisiones para Mauro

D1 preguntas redactadas por el modelo · D2 sección Proyectos · D3 `pdfjs-dist` · D4 viñetas originales en las tarjetas · D5 tope de USD por charla · D6 convive con `/cv/armar` · D7 mergear #514 primero. Recomendaciones y estado: [`plan-coach-cv.md`](./plan-coach-cv.md) §6.

## 8. Plan por fases

Fase 0 destrabar #514 y #511 · Fase 1 arreglos al chat actual (multi-campo, acuse, Proyectos, puerta «Tengo CV») · Fase 2 coach (ADR, `cv_review`, `cv_coach_turn`, pantallas, PDF) · Fase 3 medición (golden de CVs, métricas, prueba con tester A). Tickets en [`plan-coach-cv.md`](./plan-coach-cv.md) §4.
