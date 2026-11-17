# Plan: del chat de CV rígido al coach de CV (R12-0, 17/11)

Solo docs. Sale del [informe del 17/11](./informe-cv-agente-17-11.md) y del código de `main` (`6cace3c`) y de `ronda/r11-1-agente-perfil-v2` (#514, `9e45527`). El ADR está en [`docs/adr/038-coach-de-cv.md`](../adr/038-coach-de-cv.md) (Proposed). No se tocó código, prompts, Neon ni Vercel.

Contenido: §1 verificación del diagnóstico · §2 ADR · §3 costo por charla · §4 tickets de la Tanda R12 · §5 plan de evals · §6 decisiones D1 a D7 · §7 resumen para Mauro.

## 1. Verificación del diagnóstico (§3 y §4 del informe)

Rutas relativas a la raíz. «#514» quiere decir que el archivo se lee en `origin/ronda/r11-1-agente-perfil-v2`.

### 1.1 Chat de producción (§3)

| # | Afirmación del informe | Veredicto | Evidencia |
|---|---|---|---|
| 1 | `nextCvTopic` sigue un orden fijo: puesto → por trabajo (empresa, cargo, fechas, tareas, logro, ¿otro?) → estudios, certificaciones, skills, idiomas, links | **Confirmado** | `packages/pipeline/src/cv-chat/state.ts:82-83` (`WORK_FIELDS`, `LIST_TOPICS`) y `:122-142` |
| 2 | La pregunta es una plantilla fija; el modelo no la elige ni la reformula | **Confirmado, con un matiz** | `cv-chat/questions.ts:14-45`. Excepción: la repregunta vigente de R4-16 sale del modelo (`questions.ts:16`). El comentario de `state.ts:2-3` («el modelo solo formula la pregunta») contradice a `questions.ts:2-4`; vale el código. Ojo: «De una a cuatro» es `questions.ts:30` |
| 3 | Un `z.strictObject` por tema; `organization` solo acepta `{ organization, noExperience }` | **Confirmado** | `cv-chat/schemas.ts:51-84` (`organization`, `:53-56`). El adaptador arma el esquema del turno solo con el tema actual (`packages/adapters/src/cv-chat/interview.ts:61-68`) y `applyCvAnswer` aplica solo ese tema (`state.ts:270-284`): lo demás se descarta sin aviso |
| 4 | `CvHistoryKind` no tiene «proyecto», así que el CV ATS no tiene sección Proyectos | **Confirmado y ampliado** | `cv-out/model.ts:9` y `:245-247`. El tipo está repetido en `cv-out/history.ts:10`, `cv-chat/state-schema.ts:30`, `cv-chat/card.ts:59` y en el **check** de la base `packages/db/schema.ts:621` (no es un enum). Además, `validateHistory` rechaza links en todos los campos (`hasLinkOrEmail`, `cv-out/history.ts`): un proyecto con link necesita columna propia |
| 5 | `follow-up.ts` repregunta solo `dates`, `duties` y `achievement`, hasta 2 veces; el modelo propone y el código valida | **Confirmado** | `cv-chat/follow-up.ts:11` (tope), `:86-107` (decide), `:66-77` (`safeFollowUpQuestion`). El validador no exige una línea ni referencia al tema: chequea largo ≥ 10, «?», sin dígitos y `SENSITIVE_QUESTION_RE`. Ese regex es privado (`:42`): el coach tiene que exportarlo |
| 6 | `chat.tsx:191`: «Si tenés un CV hecho, no lo pegues acá» | **Confirmado y ampliado** | `apps/web/app/(app)/cv/armar/chat.tsx:191`. Además, el servidor rechaza un CV pegado: `classifyCvChatInput` (`cv-chat/input.ts:77`) → `redirect_cv_reader` (`adapters/src/cv-chat/interview.ts:100`) → error `pasted_cv` con link a `/settings/historial` (`apps/web/app/api/cv-chat/route.ts:89` y `:345`) |
| 7 | El acuse es genérico | **Confirmado, con la causa** | El acuse lo escribe el modelo y `safeCvAck` lo reemplaza por el acuse fijo si trae **cualquier dígito** (`cv-chat/grounding.ts:55-57`). Un acuse con fechas («abril 2025») nunca puede pasar: tiene que armarlo el código |
| 8 | El puesto ya estaba en el perfil y se vuelve a preguntar (lo arregla #511) | **Confirmado** | `loadChatSeed` no siembra `target` (`apps/web/lib/cv-chat-server.ts:41-61`); #511 suma `chatTarget(headline, roleLabel)` en `state.ts` (rama `ronda/r11-12-cv-resumen`) |
| 9 | ADR-026 dejó «pregunta redactada por el modelo en una segunda llamada» como opción si Mauro la prefiere | **Confirmado** | `docs/adr/026-cv-redactado-por-ia-con-verificador.md`, Alternatives |
| 10 | «El cargo quedó cargado de dos formas» y fechas con febrero contra marzo | **No verificable en código** (la charla no se guarda, ADR-026 §4). Es coherente con #3: cada tema extrae por separado y nada contrasta con lo ya dicho |

### 1.2 Agente de perfil (#514, §4)

| # | Afirmación del informe | Veredicto | Evidencia |
|---|---|---|---|
| 11 | #514 sube el CV (DOCX en el navegador) y propone tarjetas por sección que se guardan con `source='cv'` | **Confirmado** | ADR-034 §2 y §9; `apps/web/components/profile-agent/extract-text.ts`, `packages/pipeline/src/profile-agent/read/cards.ts` (#514) |
| 12 | Huecos con plantillas por carrera y hasta 2 repreguntas | **Confirmado y más rígido de lo que dice el informe** | `packages/prompts/profile_gaps.v1.md` (default más 8 carreras). Temas: solo `achievement`, `duties`, `dates` y `skill_level` (`profile-agent/schemas.ts`, `GAP_TOPICS`). #514 **apaga** la repregunta redactada por el modelo que hoy existe en `main`: fija `followUps` en el tope antes de llamar a `cv_interview` (`adapters/src/profile-agent/gaps/turn.ts:99`) |
| 13 | El PDF no se lee | **Confirmado** | `components/profile-agent/extract-text.ts:54-55` (#514): `pdf_paste`, pide pegar el texto |
| 14 | «Hueco» es un campo vacío o flojo, no una crítica | **Confirmado** | `profile-agent/gaps/detect.ts` (#514): falta de fecha de inicio, tareas de menos de 4 palabras, ninguna viñeta con número (`hasResultNumber`, `:47` y `:86`) y skills con nivel «tutorial». No mira el puesto ni el mercado |
| 15 | La lectura detecta proyectos en `facts` con `kind: "proyecto"` | **Corregido** | `facts` ya está en **`main`** (`packages/pipeline/src/cv/extraction.ts:49`), no es nuevo de #514. #514 no lo usa: `buildReadCards` no lee `facts` (`read/cards.ts:44-95`) |
| 16 | Las tarjetas de lectura salen sin viñetas | **Confirmado** | `read/cards.ts:57` (`bullets: []`), decisión de ADR-034 §2 |
| 17 | No hay comparación antes/después | **Confirmado** | No hay nada parecido en `profile-agent/close/**` (#514) ni en `cv-out/**` |
| 18 | #514 y #511 se pueden mergear juntos | **Verificado** | `git merge-tree` de las dos ramas sale sin conflictos (17/11) |
| 19 | Las skills más pedidas del pool «ya las calcula `skills/market.ts`» | **Confirmado** | `packages/pipeline/src/skills/market.ts:23` (`computeDemand`); #514 ya la usa en la guía (`skills/plan.ts`) |

**Conclusión:** el diagnóstico del informe se sostiene. Hay cuatro correcciones o agregados que cambian el plan: el tipo vive también en un **check** de la base y hace falta una columna `link` (#4); el acuse genérico lo causa el filtro de dígitos (#7); `facts` ya existe en `main` (#15); y #514 es más rígido que `main` en las repreguntas (#12).

## 2. ADR

[`docs/adr/038-coach-de-cv.md`](../adr/038-coach-de-cv.md), Proposed. Cubre las etapas, los esquemas Zod de `cv_review` y `cv_coach_turn`, el validador de preguntas, el tipo `proyecto` en `career_history`, los topes, el flag y lo que no se guarda. Las decisiones D1 a D7 están marcadas «a confirmar por Mauro». Numeral 038: 034 a 037 ya están tomados en ramas abiertas.

## 3. Costo por charla

Tarifas del seed (`packages/db/seeds/model_routing.json`, #514): primario `gemini-3.5-flash` a USD 1,5 por millón de tokens de entrada y USD 9 de salida, con thinking `minimal` (0 tokens de razonamiento medidos). Respaldos: Haiku 4.5 (1 / 5) y, en `cv_write`, Sonnet 5.5 (2 / 10). **Son estimados sin corrida real**: las tareas nuevas no existen. Los tamaños salen de `docs/LLM_COSTOS.md` y de `docs/beta/agente-perfil-pruebas.md` §5 (#514).

| Paso | Tarea | Llamadas | Tokens supuestos (entrada / salida) | Típico | Máximo del paso | Reserva |
|---|---|---|---|---|---|---|
| Lectura | `extract_cv_profile` v2 | 1 | 4.500 / 1.800 (suma viñetas y proyectos) | USD 0,023 | USD 0,05 | USD 0,08 |
| Diagnóstico | `cv_review` | 1 | 4.500 / 800 (CV confirmado, puesto, demanda del pool) | USD 0,014 | USD 0,04 | USD 0,05 |
| Turno | `cv_coach_turn` | N | 2.800 / 300 (ítem en foco, problema, lo ya dicho, mensaje) | USD 0,007 | USD 0,032 (primario y respaldo agotando 1536) | USD 0,04 |
| Redacción | `cv_write` | 1 | 3.500 / 900 (suma Proyectos) | USD 0,013 | USD 0,036 | USD 0,07 |

| Charla | Cuenta | Total |
|---|---|---|
| Corta (N = 8) | 0,023 + 0,014 + 8 × 0,007 + 0,013 | **≈ USD 0,11** |
| Típica (N = 12) | 0,023 + 0,014 + 12 × 0,007 + 0,013 | **≈ USD 0,13** |
| Tope de turnos (N = 15) | 0,023 + 0,014 + 15 × 0,007 + 0,013 | **≈ USD 0,16** |
| Peor caso (todo al máximo, N = 15) | 0,05 + 0,04 + 15 × 0,032 + 0,036 | USD 0,61 → **lo corta el tope de USD 0,30** cerca del turno 5, con la redacción ya reservada (abajo) |

**Regla nueva que sale de esta cuenta:** un turno se rechaza si lo gastado, más la reserva del turno, más la reserva de la redacción (USD 0,07) superan el tope. Si no, una charla cara podría agotar el tope antes del cierre y la persona se quedaría sin CV. Está en ADR-038 §9.

**Comparación con los topes actuales:**
- `/cv/armar` (ADR-026 §5): **USD 0,15 y 25 turnos por charla**, reserva de USD 0,03 por turno. Típico medido en papel: USD 0,03 a 0,039 por CV (`docs/LLM_COSTOS.md`, R4-16). El coach cuesta **unas 4 veces más** por charla.
- Agente de perfil (ADR-034 §6): **USD 0,30 por charla**, 20 turnos de `cv_interview`; típico estimado de USD 0,08.
- **Propuesta (D5):** USD 0,30 por charla del coach, 15 turnos. Da el doble de margen sobre la charla típica y deja la lectura en el mismo cupo de ADR-034. Por persona: con 3 lecturas gratis por mes, ≈ USD 0,40 típicos y USD 0,90 como máximo; con plan pago (10), ≈ USD 1,30 típicos. El tope diario de USD 0,50 por persona se comparte con el agente.
- **A medir en la Fase 3:** tokens reales por tarea en `llm_calls` con `label = cv:<flowId>`. Si la típica real supera USD 0,20, bajar los turnos a 12 antes de pasar `CV_COACH` a `all`.

## 4. Tanda R12: tickets por fase

Convenciones: un ticket por rama `ronda/r12-<n>-<nombre>`; carril según `.github/carril-rojo.txt` (rojo si toca `packages/db/**`, `packages/prompts/**`, `evals/**`, `apps/web/app/api/**`, `**/actions.ts`, `packages/pipeline/src/cv/**`, `packages/adapters/src/cv/**` o `package.json`). Lo rojo va en el PR único de la tanda (ADR-031). La Fase 0 asume #514 y #511 mergeados.

**Archivos compartidos que nadie edita fuera de su ticket dueño:** `packages/pipeline/src/cv-chat/schemas.ts` (R12-2), `cv-chat/state.ts` (R12-2), `adapters/src/cv-chat/interview.ts` (R12-2, después R12-3), `cv-out/model.ts` y `cv-out/history.ts` (R12-4), `pipeline/src/cv-coach/schemas.ts` (R12-7, contrato del lead).

### Fase 0 · Destrabar lo hecho

| Ticket | Carril | Deps | Qué hace / archivos | Tests |
|---|---|---|---|---|
| **R12-1** Integrar #514 y #511 | rojo (ya lo son) | — | Sin código nuevo: el merge de las dos ramas está limpio. **Pasos de Mauro:** mergear #514 y #511; aplicar la fila `extract_cv_profile` en Neon (SQL de ADR-034, «Pasos»); en Vercel, `CV_IMPORT_ENABLED=1` y `CV_PROFILE_AGENT=testers`. Mauro repite la prueba con su CV pegado; el lead pasa sus notas a `docs/beta/coach-cv-prueba-0.md` (verde) | CI de los dos PR |

### Fase 1 · Arreglos al chat actual (sirven aunque D1 sea «no»)

| Ticket | Carril | Deps | Archivos propios | Tests que exige |
|---|---|---|---|---|
| **R12-4** Proyectos en `career_history` y en el CV ATS (D2) | rojo (migración) | R12-1 | `packages/db/schema.ts` (check con `proyecto`, columna `link`), `packages/db/drizzle/00xx_*.sql` (generado), `packages/db/src/career-history.integration.test.ts`; `pipeline/src/cv-out/{history,model,docx,verify}.ts`; `pipeline/src/cv-chat/{state-schema,card}.ts`; `apps/web/lib/career-history.ts`; `apps/web/app/(app)/settings/historial/{page,actions}.ts(x)` | historia con `proyecto` y `link` válido o inválido (`http:`, email, 201 caracteres); sección «Proyectos» / «Projects» en el CV y el DOCX; el verificador acepta el nombre y el stack del proyecto como fuente; integración: RLS de la columna nueva con dos usuarios; e2e 85 sigue verde |
| **R12-2** Extracción multi-campo en el chat (`extras`) | rojo (prompt) | R12-1, R12-4 | `pipeline/src/cv-chat/{schemas,state}.ts` y nuevo `cv-chat/extras.ts`; `adapters/src/cv-chat/{interview,estimate}.ts`; `packages/prompts/cv_interview.v3.md` | «empresa, cargo y fechas en un mensaje» no vuelve a preguntar cargo ni fechas; los proyectos dichos en «cargo» quedan como tarjeta `proyecto`; un extra sin grounding o con un dato sensible se descarta entero; `extras` opcional con `default([])`: los tests de huecos de #514 (`profile-agent/gaps/turn.ts`) siguen verdes; reserva recalculada |
| **R12-3** Acuse que refleja lo entendido y contradicciones | verde | R12-2 | nuevos `pipeline/src/cv-chat/{ack,conflicts}.ts`; `cv-chat/questions.ts` (plantilla «¿Cuál dejo?»); `adapters/src/cv-chat/interview.ts` (después de R12-2); `apps/web/app/(app)/cv/armar/chat.tsx` (chips de la contradicción y saca la línea 191) | acuse armado por el código con empresa, cargo y meses; nunca texto del modelo con dígitos; contradicción de fechas y de cargo contra lo confirmado y lo ya dicho; sin contradicción no hay pregunta extra |
| **R12-6** Puerta única en `/cv`: «Tengo CV» / «No tengo CV» (D6) | rojo (`app/api/**`) | R12-1 | `apps/web/app/(app)/cv/page.tsx`; `apps/web/app/api/cv-chat/route.ts` (el `pasted_cv` lleva a `/cv/perfil` en vez de `/settings/historial`, `:345`) | e2e: con el flag, la puerta lleva a cada flujo; sin el flag, `/cv` queda como hoy; el mensaje `pasted_cv` apunta a la lectura |

### Fase 2 · Coach de CV (necesita D1 y el ADR-038 aceptado)

| Ticket | Carril | Deps | Archivos propios | Tests que exige |
|---|---|---|---|---|
| **R12-7** Contrato del coach (lead) | verde | ADR-038 aceptado | `docs/adr/038-coach-de-cv.md` (Accepted); `pipeline/src/cv-coach/{schemas,issues,limits,flag,routes,index}.ts`; índices vacíos `cv-coach/{review,turn,close}/index.ts` y `adapters/src/cv-coach/{index,review/index,turn/index}.ts`; una línea en `pipeline/src/index.ts`; `export` de `SENSITIVE_QUESTION_RE` y de los tipos base de `cv-chat/schemas.ts` | esquemas estrictos (campo de más → falla); `cvCoachAllowed` (valores inválidos = apagado, exige `CV_PROFILE_AGENT`); topes y reservas como constantes; el estado del navegador no tiene dónde llevar el texto del CV |
| **R12-8** Diagnóstico `cv_review` | rojo (prompt, seed) | R12-7, R12-4 | `pipeline/src/cv-coach/review/**` (validar referencias, citas como substring, brechas desde `computeDemand`, orden y recorte, textos de plantilla por tipo, firma de la lista); `adapters/src/cv-coach/review/**` (llamada, reserva paso `review`); `packages/prompts/cv_review.v1.md`; fila en `packages/db/seeds/model_routing.json` | problema con `ref` inexistente o `skillSlug` fuera de la taxonomía → descartado; cita que no está en el ítem → sin cita; brecha que el modelo no vio pero los datos sí → agregada; orden y recorte (10 y 3 por ítem); lista alterada en el navegador → `409`; inyección en el CV no cambia el orden; reserva entre 1 y 1,25 veces el máximo |
| **R12-9** Turno `cv_coach_turn` | rojo (prompt, seed) | R12-7, R12-2 | `pipeline/src/cv-coach/turn/**` (aplicar `patch` y `extras` como tarjetas, resolver problemas por tipo, validador de preguntas `question.ts`, respaldo); `adapters/src/cv-coach/turn/**`; `packages/prompts/{cv_coach_turn,cv_coach_fallbacks}.v1.md`; fila en el seed | validador: rechaza dígitos, links, sensibles, dos líneas, nombres propios ajenos y preguntas sin ancla, y cae a la plantilla; `declined` cierra el problema sin repreguntar; un extra fuera de foco no se pierde; tope de 15 turnos y de USD 0,30 con filas de costo `null` (O1 de ADR-034) |
| **R12-10** Pantallas y rutas del coach | rojo (`app/api/**`) | R12-8, R12-9 | `apps/web/app/api/cv-coach/{diagnostico,turno}/route.ts`; `apps/web/lib/cv-coach/*.ts`; `apps/web/components/cv-coach/{diagnosis,chat}.tsx`; `apps/web/app/(app)/cv/coach/{page,charla/page}.tsx` | cada ruta sin sesión → 401 sin tocar base ni modelo; flag apagado → 404; ticket o lista inválidos → 409; e2e con el modelo de demo: diagnóstico, dos turnos, «Ya está, armalo» |
| **R12-11** Cierre y «qué mejoró» | verde | R12-7 (puro), R12-10 (pantalla) | `pipeline/src/cv-coach/close/**` (`diffCv(before, after, issues)` puro); `apps/web/components/cv-coach/improved.tsx`; `apps/web/app/(app)/cv/coach/listo/page.tsx` | diff de viñetas lado a lado; problemas resueltos, abiertos y salteados; sin la foto «antes», solo los problemas; la vista no muestra texto que no esté en la base o en la foto |
| **R12-12** PDF con `pdfjs-dist` (D3) | rojo (`package.json`) | R12-1 | `apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/components/profile-agent/extract-text.ts`, worker en `apps/web/public/` | PDF de texto → mismo texto que el DOCX equivalente; PDF escaneado → mensaje de pegar texto; el import es dinámico (el bundle de otras páginas no crece); CSP sin `unsafe-eval` |
| **R12-5** Lectura con viñetas originales y tarjeta de proyectos (D2, D4) | rojo (`pipeline/src/cv/**`, prompt) | R12-1, R12-4 | `pipeline/src/cv/extraction.ts` (viñetas por trabajo, proyectos con rol, link y stack); `packages/prompts/extract_cv_profile.v2.md`; `pipeline/src/profile-agent/read/cards.ts`; `components/profile-agent/cards.tsx`. `profile-agent/schemas.ts` es contrato de ADR-034: el cambio lo hace el lead en R12-7 | una viñeta que no es substring normalizado del texto leído se descarta; tarjeta de proyecto con link válido o sin link; las viñetas se marcan «de tu CV»; nada sensible ni inyectado llega a la tarjeta |

### Fase 3 · Medición

| Ticket | Carril | Deps | Archivos propios | Tests que exige |
|---|---|---|---|---|
| **R12-13** Golden de CVs y harness del coach | rojo (`evals/**`) | R12-8, R12-9 | `evals/fixtures/cv-coach/*.json` (públicas, inventadas); `evals/src/cv-coach/{run,metrics,persona}.ts`; el CV de Mauro en `fixtures-private/cv-coach/` (fuera del repo) | métricas sobre transcripciones grabadas (sin modelo); el guard de costo aborta antes de pasar el tope; ninguna fixture pública pasa el barrido de privacidad con datos reales |
| **R12-14** Prueba con Ani y comparación de Mauro | verde | R12-10, R12-11 | `docs/beta/coach-cv-prueba.md` | — |
| **R12 · Cierre** | verde | todo en PR | `docs/BACKLOG.md`, `docs/beta/informe-r12.md` | — |

**Paralelismo:** después de R12-1 arrancan en paralelo R12-4, R12-6, R12-12 y, cuando Mauro acepte el ADR, R12-7. R12-2 espera a R12-4; R12-3 a R12-2; R12-8 y R12-9 corren en paralelo sobre R12-7; R12-5 va en paralelo con R12-8 y R12-9 (no comparten archivos). Los cuatro tickets que tocan prompts (R12-2, R12-5, R12-8, R12-9) juntan su cambio de prompt en **un push cada uno**.

## 5. Plan de evals

### 5.1 Golden de CVs
- **Públicas (inventadas, sin datos reales, empresas «Empresa A» y similares):** los 3 de #514 (`packages/pipeline/test/fixtures/cv-perfil/{sin-experiencia,con-experiencia,cambio-de-carrera}.txt`) más **uno por carrera de la beta** (abogacía, finanzas y contabilidad, administración, comunicación, marketing digital, relaciones públicas, relaciones internacionales y fullstack): 11 en total. Uno de los de fullstack replica el caso del 17/11 (dos años de experiencia, cuatro proyectos con IA y docencia arriba), con nombres ficticios.
- **Privada:** el CV de Mauro en `fixtures-private/cv-coach/mauro.json`. No entra al repo ni a los reportes (que guardan solo métricas).
- **Cada fixture trae:** el texto del CV; el puesto objetivo; `hechos[]` (datos atómicos con sus claves: empresa, cargo, fechas, proyecto, número de un logro); `problemas_esperados[]` (tipo y ítem); y `respuestas` guionadas por tipo de problema e ítem, con «no tengo» por defecto. **La persona es código, no un modelo:** no suma costo y es repetible.
- **La lectura se cachea:** la primera corrida guarda la propuesta normalizada de cada fixture pública (`evals/fixtures/cv-coach/lecturas/*.json`); las siguientes arrancan del diagnóstico.

### 5.2 Métricas por charla (todas en código, sin juez LLM)
| Métrica | Definición | Umbral para pasar `CV_COACH` a `all` |
|---|---|---|
| Invenciones | tokens del CV final que `cvRejectReasons` marca contra las fuentes (texto del CV y respuestas) | **0**, bloqueante |
| Datos perdidos | `hechos` del CV o de las respuestas que no aparecen en el CV final, sobre el total | ≤ 5 % |
| Preguntas repetidas | preguntas cuyo problema apunta a un campo ya completo o ya dicho en un turno anterior, sobre el total de preguntas | ≤ 10 % |
| Problemas resueltos | resueltos sobre detectados | informativa |
| Diagnóstico | *recall* y precisión de `cv_review` contra `problemas_esperados` | *recall* ≥ 0,7 · precisión ≥ 0,6 |
| Respaldo de preguntas | preguntas que cayeron a plantilla, sobre el total | informativa (si supera 30 %, revisar el prompt) |
| Turnos, costo y tiempo | de `llm_calls` (`task = eval:<versión>`, `label = r12`) y del reloj | costo típico ≤ USD 0,20 |

**Línea de base:** la transcripción del 17/11 (con nombres ficticios) corre una vez en el chat actual antes y después de R12-2, para medir datos perdidos y preguntas repetidas sin el coach.

### 5.3 Presupuesto (tope de la tanda: USD 3)
| Corrida | Cuenta | USD |
|---|---|---|
| Lectura de las 12 fixtures (una vez, se cachea) | 12 × 0,023 | 0,28 |
| `cv_review` en el golden, 3 corridas (varianza) | 3 × 12 × 0,014 | 0,50 |
| Charla completa guionada: sin experiencia, con experiencia, cambio de carrera y Mauro, 2 corridas | 2 × 4 × 0,12 | 0,96 |
| Línea de base del chat actual, antes y después de R12-2 | 2 × 0,04 | 0,08 |
| Job de evals del CI por push con prompts (mide `evaluate_job`, no el coach), 4 pushes | 4 × 0,16 | 0,64 |
| **Total** | | **≈ USD 2,46** (margen de 0,54) |

- **Cómo no pasarse:** el harness copia el guard de `evals/src/cost-guard.ts`. Usa `--max-usd 0,60` por corrida (se aborta antes de la primera llamada si la estimación lo supera, y en vuelo si lo gastado más lo reservado lo supera). Antes de arrancar suma `llm_calls` con `label = r12` y no corre si el acumulado de la tanda pasa USD 2,50. Todo lo demás (validadores, orden, métricas sobre transcripciones grabadas) corre en CI **sin modelo**.
- **Quién corre qué:** las corridas pagas las hace Mauro o el lead con su OK, en local y con `--db cloud` para que el gasto quede registrado. Ninguna corre sola en el CI.
- Si las primeras corridas salen más caras que lo estimado, se recorta la segunda corrida de la charla completa, no las de diagnóstico.

## 6. Decisiones para Mauro

| # | Decisión | Recomendación | Qué bloquea |
|---|---|---|---|
| D1 | ¿El modelo redacta las preguntas (validadas por el código, con plantilla de respaldo)? Reabre ADR-026 §3 y ADR-034 §1 solo para el coach | **Sí**, con temario del código y una llamada por turno | toda la Fase 2 |
| D2 | ¿Proyectos en el CV y en `career_history` (check + columna `link`)? | **Sí** | R12-4, R12-2, R12-5 |
| D3 | ¿Dependencia `pdfjs-dist`? | **Sí**, import dinámico solo en la lectura | R12-12 |
| D4 | ¿Viñetas originales del CV en las tarjetas, marcadas «de tu CV»? | **Sí**, solo si son substring del texto leído | R12-5 |
| D5 | Tope por charla del coach | **USD 0,30 y 15 turnos**; se revisa con la Fase 3 | R12-7 |
| D6 | ¿Reemplaza a `/cv/armar` o convive? | **Convive**, con una puerta en `/cv` | R12-6 |
| D7 | ¿Mergear #514 (y #511) primero? | **Sí**: merge limpio, el coach se apoya en su lectura, ticket y topes | todo |

Además, dos decisiones que salieron de la verificación: un flag propio **`CV_COACH`** (recomendado, para prenderlo sin tocar el agente) y que **el diagnóstico no muestre texto libre del modelo**, solo tipos con plantillas del código (recomendado: más auditable y sin verificador nuevo).

## 7. Resumen para Mauro

1. Lo que probaste es `/cv/armar` (ADR-026): descarta todo lo que no es el tema actual porque el esquema es uno por tema. Es una decisión de diseño, no un bug. Verificado en el código.
2. Correcciones al informe: los proyectos (`facts`) ya se detectan en `main`; `kind` es un check de la base y un proyecto con link necesita columna nueva; el acuse es genérico porque cualquier dígito lo reemplaza por el fijo; #514 apaga las repreguntas del modelo.
3. Fase 0 sin código: mergeá #514 y #511 (el merge entre las dos está limpio), aplicá la fila `extract_cv_profile` en Neon y poné `CV_IMPORT_ENABLED=1` y `CV_PROFILE_AGENT=testers`.
4. La Fase 1 arregla el chat actual aunque digas no al coach: multi-campo, acuse con lo entendido, contradicciones, Proyectos y la puerta «Tengo CV / No tengo CV».
5. El coach (ADR-038, Proposed): diagnóstico tipado con `cv_review` y una llamada por turno con `cv_coach_turn`; el temario es del código y cada pregunta pasa un validador o cae a plantilla.
6. Costo estimado: ≈ USD 0,13 por charla típica, unas 4 veces `/cv/armar` (USD 0,035). Tope propuesto: USD 0,30 y 15 turnos.
7. Evals: 11 CVs inventados más el tuyo en `fixtures-private`, persona guionada en código, métricas sin juez LLM. ≈ USD 2,46 de los USD 3 de la tanda, con guard.
8. Decidís: D1 (el modelo redacta preguntas), D2 (Proyectos con migración), D3 (`pdfjs-dist`) y D5 (tope).
9. También: D4 (viñetas «de tu CV»), D6 (convive con `/cv/armar`), D7 (#514 primero) y el flag propio `CV_COACH`.
10. Con D1 en «no», se hacen la Fase 0 y la Fase 1 y el ADR-038 queda en Rejected.
