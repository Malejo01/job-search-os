# Costos de AfinIAJobs

Este archivo tiene dos secciones:

1. [Topes](#topes): inventario de todos los topes de gasto y de uso, con su valor por defecto, dónde se leen y cuáles se pueden cambiar por variable de entorno.
2. [Calculadora de margen](#calculadora-de-margen): costo de IA por persona, margen y punto de equilibrio, con los valores por defecto y de dónde sale cada uno.

Análisis previo, de lectura: [`costos-por-usuario.md`](./costos-por-usuario.md).

## Topes

Estado al 23/11/2026, rama de la R21 (sale de `main` 8e3ebab). Las rutas son relativas a la raíz del repo y los números de línea son de esta rama.

### Cómo se leen las variables nuevas

Los topes marcados **nueva** (R21-04) pasan por una sola función pura, `readCap(env, nombre, default, { kind, max? })` en `packages/pipeline/src/cap-env.ts`.

- `kind: "int"` acepta solo dígitos; `kind: "decimal"` acepta dígitos con punto decimal (`0.25`).
- El valor tiene que ser **mayor que cero**. Ausente, vacío o inválido (texto, negativo, cero, coma decimal, notación científica, fuera del máximo) vale el default exacto: no rompe y no apaga nada. Para «sin tope» no hay variable nueva: se sube el número.
- Los valores por defecto son los mismos que había fijos en el código. Con las variables sin definir, nada cambió.
- Los topes viejos conservan su propia lectura (por ejemplo `LLM_DAILY_CAP_USD=0` desactiva el tope y un valor inválido lanza error): no se tocaron.

### Qué se puede operar y qué no

- **Variable** = se cambia en el entorno (Vercel) sin deploy de código.
- **Fijo** = constante en el código. Se lista para que esté a la vista, pero queda fija a propósito: o es un límite de seguridad de entrada (tamaño, timeout, largo de campo), o está atado a otra cosa (tarifas de `model_routing`, un test, el esquema de un estado firmado, una cuota de un proveedor) y cambiarlo sin tocar eso rompe la garantía que da.

### 1. Gasto de LLM: global y por persona

| # | Tope | Qué controla | Default | Dónde | Cambia por variable |
|---|---|---|---|---|---|
| 1 | Tope diario global | USD que gastan en 24 h evaluaciones, borradores y asistente (las tareas del chat de CV y del agente de perfil tienen su propio tope) | USD 2 | `packages/adapters/src/llm/spend.ts:58` (lectura `:61`) | `LLM_DAILY_CAP_USD` (0 desactiva; inválido lanza error) |
| 2 | Tope diario por persona | USD que una persona puede gastar en 24 h, además del global | USD 1 | `packages/adapters/src/llm/spend.ts:71` (lectura `:77`) | `LLM_USER_DAILY_CAP_USD` (0 desactiva; inválido lanza error) |
| 3 | Reservas vivas por persona | Cuántas reservas de gasto simultáneas puede tener una persona antes de rechazarle pedidos nuevos | 3 | `packages/adapters/src/llm/spend-reserve.ts:45` (lectura `:48`) | `LLM_RESERVE_MAX_CONCURRENT` (entero ≥ 1; inválido = 3) |
| 4 | Parte reservada del tope global | Último 20 % del tope global, solo para quien casi no gastó | 0,20 | `packages/adapters/src/llm/spend.ts:145` | Fijo |
| 5 | Piso por persona dentro de esa parte | Hasta el 5 % del tope global gastado, la persona puede usar la parte reservada | 0,05 | `packages/adapters/src/llm/spend.ts:147` | Fijo |
| 6 | Estimado de llamada fallida | USD que cuenta una llamada fallida sin costo (timeout, 5xx) para los topes | USD 0,04 | `packages/adapters/src/llm/spend.ts:53` | Fijo (afecta la medición de todos los topes) |
| 7 | Vida de una reserva | Minutos que cuenta una reserva viva si el proceso muere | 5 min | `packages/adapters/src/llm/spend-reserve.ts:23` | Fijo |
| 8 | Espera del lock global | Milisegundos máximos por el lock de reservas (entre 100 y 5000) | 3000 ms | `packages/adapters/src/llm/spend-reserve.ts:40` | Fijo |
| 9 | Avisos de presupuesto | Umbrales del tope global en que se avisa por email, y cada cuánto se revisa | 70, 85 y 95 %; 5 min | `packages/pipeline/src/budget/alerts.ts:8`, `:83` | Fijo |
| 10 | Tope semanal de la demo | USD que puede gastar en 7 días la demo de la vitrina | USD 1 | `packages/adapters/src/demo/run.ts:33` (lectura `:140`) | **Nueva:** `DEMO_WEEKLY_CAP_USD` |
| 11 | Reserva por iteración de la demo | USD que se reserva antes de cada evaluación de la demo | USD 0,05 | `packages/adapters/src/demo/run.ts:40` | Fijo |

### 2. Reservas por paso (máximo de un paso, no el promedio)

Están atadas a las tarifas de `model_routing` por tests de adapters (`evaluation-reserve.test.ts`, `estimate.test.ts`, entre otros): si se cambia un modelo, el test dice si la reserva quedó corta. Por eso quedan fijas.

| # | Tope | Qué controla | Default | Dónde | Cambia por variable |
|---|---|---|---|---|---|
| 12 | Reserva de una evaluación | Máximo con respaldo incluido | USD 0,17 | `packages/adapters/src/llm/spend-reserve.ts:29` | Fijo |
| 13 | Reserva de una tanda de borradores | Máximo con respaldo incluido | USD 0,12 | `packages/adapters/src/llm/spend-reserve.ts:31` | Fijo |
| 14 | Reserva de un turno del asistente | 6 pasos a USD 0,03 | USD 0,18 | `packages/adapters/src/llm/assistant-reserve.ts:15` | Fijo |
| 15 | Reserva de las preguntas de Interview | Generar las 5 preguntas | USD 0,03 | `packages/adapters/src/interview/reserve.ts:31` | Fijo |
| 16 | Reserva de la devolución de Interview | Evaluar una respuesta | USD 0,06 | `packages/adapters/src/interview/reserve.ts:33` | Fijo |
| 17 | Reserva de un turno del chat de CV | Un turno de entrevista | USD 0,03 | `packages/pipeline/src/cv-chat/limits.ts:48` | Fijo |
| 18 | Reserva de la redacción del CV | `cv_write` | USD 0,08 | `packages/pipeline/src/cv-chat/limits.ts:49` | Fijo |
| 19 | Reserva de la lectura de CV | Lectura del agente de perfil | USD 0,08 | `packages/pipeline/src/profile-agent/limits.ts:20` | Fijo |
| 20 | Reservas del coach de CV | Lectura 0,08 · diagnóstico 0,07 · turno 0,045 · redacción 0,08 | ver detalle | `packages/pipeline/src/cv-coach/limits.ts:37` | Fijo |

### 3. Asistente (conversaciones con herramientas)

| # | Tope | Qué controla | Default | Dónde | Cambia por variable |
|---|---|---|---|---|---|
| 21 | Mensajes por charla | Turnos de la persona en una conversación (máximo configurable 50) | 20 | `packages/pipeline/src/agent/limits.ts:11` (lectura `:48`; lector web `apps/web/lib/assistant-limits.ts:17`) | `ASSISTANT_MAX_TURNS` (entero 1 a 50; inválido = 20) |
| 22 | USD por charla | Gasto máximo de una conversación (máximo configurable USD 5) | USD 0,50 | `packages/pipeline/src/agent/limits.ts:15` | `ASSISTANT_MAX_USD_PER_CONVERSATION` (decimal > 0 hasta 5; inválido = 0,50) |
| 23 | Charlas por mes | Conversaciones nuevas por mes: pisa todo si está; si no, la del plan (gratis 3, pago 30) con `PRICING_ENABLED`; apagado, la del plan gratis | 3 | `packages/pipeline/src/agent/limits.ts:193` | `ASSISTANT_MONTHLY_CONVERSATIONS` (entero 1 a 1000) |
| 24 | Pasos por turno | Pasos del modelo en un turno | 6 | `packages/pipeline/src/agent/limits.ts:12` | Fijo (la reserva del #14 es 6 pasos) |
| 25 | Tokens de salida por paso | `max_tokens` de cada paso | 600 | `packages/pipeline/src/agent/limits.ts:13` | Fijo |
| 26 | Tokens de entrada por llamada | Peor caso de entrada estimado | 12.000 | `packages/pipeline/src/agent/limits.ts:14` | Fijo |
| 27 | Largo de un mensaje | Caracteres del mensaje de la persona | 2.000 | `packages/pipeline/src/agent/limits.ts:16` | Fijo (seguridad de entrada) |

### 4. Chat de CV

| # | Tope | Qué controla | Default | Dónde | Cambia por variable |
|---|---|---|---|---|---|
| 28 | Tope diario global | USD por día de todo el chat de CV | USD 1 | `packages/pipeline/src/cv-chat/limits.ts:11` (lectura `:158`) | `CV_CHAT_DAILY_CAP_USD` (ausente = 1; inválido o negativo = 0, cerrado) |
| 29 | USD por persona y día | Gasto de entrevistas de una persona en 24 h | USD 0,30 | `packages/pipeline/src/cv-chat/limits.ts:19` | **Nueva:** `CV_CHAT_USER_DAILY_CAP_USD` |
| 30 | Charlas nuevas por persona y día | Cuántas charlas puede empezar una persona en 24 h | 5 | `packages/pipeline/src/cv-chat/limits.ts:20` | **Nueva:** `CV_CHAT_MAX_STARTS_PER_DAY` |
| 31 | USD por charla | Gasto máximo de una charla | USD 0,15 | `packages/pipeline/src/cv-chat/limits.ts:10` | **Nueva:** `CV_CHAT_MAX_COST_USD` |
| 32 | Mensajes por charla | Turnos de una charla | 25 | `packages/pipeline/src/cv-chat/state.ts:11` | Fijo (forma parte del estado firmado) |
| 33 | CV por mes y turnos por mes (beta) | Piso de la beta: 3 CV por mes y 40 turnos de entrevista por mes | 3 y 40 | `packages/pipeline/src/plans.ts:75` | Fijo (por plan) |
| 34 | Ventana mensual | Días móviles de los topes mensuales | 30 | `packages/pipeline/src/cv-chat/limits.ts:13` | Fijo |
| 35 | Fallos y repreguntas | Respuestas ilegibles por tema (2) y repreguntas (2) | 2 y 2 | `packages/pipeline/src/cv-chat/state.ts:19`, `packages/pipeline/src/cv-chat/follow-up.ts:11` | Fijo |

### 5. Agente de perfil (lectura de CV, huecos, cierre)

| # | Tope | Qué controla | Default | Dónde | Cambia por variable |
|---|---|---|---|---|---|
| 36 | Tope diario global | USD por día de las tres tareas del agente (lo comparte el coach) | USD 1 | `packages/pipeline/src/profile-agent/limits.ts:30` (lectura `:88`) | `CV_PROFILE_AGENT_DAILY_CAP_USD` (ausente = 1; inválido o negativo = 0, cerrado) |
| 37 | USD por persona y día | Gasto de la persona en 24 h, de todas sus charlas (lo comparte el coach) | USD 0,50 | `packages/pipeline/src/profile-agent/limits.ts:29` | **Nueva:** `CV_PROFILE_AGENT_USER_DAILY_CAP_USD` |
| 38 | USD por charla | Gasto real de una charla completa | USD 0,30 | `packages/pipeline/src/profile-agent/limits.ts:27` | **Nueva:** `CV_PROFILE_AGENT_MAX_FLOW_COST_USD` |
| 39 | Lecturas por persona y día | Intentos de lectura de CV en 24 h | 3 | `packages/pipeline/src/profile-agent/limits.ts:13` | **Nueva:** `CV_PROFILE_AGENT_MAX_READS_PER_DAY` |
| 40 | Lecturas por mes | 3 en el plan gratis, 10 en el pago | 3 y 10 | `packages/pipeline/src/profile-agent/limits.ts:9` | Fijo (por plan; repite `cvReadsPerMonth` de `plans.ts`) |
| 41 | Turnos de huecos | Llamadas del modelo por charla | 20 | `packages/pipeline/src/profile-agent/limits.ts:23` | Fijo |
| 42 | Repreguntas por tema y redacciones | Repreguntas (2) e intentos de redacción por charla (2) | 2 y 2 | `packages/pipeline/src/profile-agent/limits.ts:25`, `packages/pipeline/src/profile-agent/close/caps.ts:15` | Fijo |
| 43 | Ventana mensual | Días móviles | 30 | `packages/pipeline/src/profile-agent/limits.ts:11` | Fijo |

### 6. Coach de CV

El coach comparte con el agente de perfil los topes por persona y día (#37) y el global (#36).

| # | Tope | Qué controla | Default | Dónde | Cambia por variable |
|---|---|---|---|---|---|
| 44 | USD por charla | Gasto máximo de una charla del coach, con la redacción reservada | USD 0,30 | `packages/pipeline/src/cv-coach/limits.ts:17` | **Nueva:** `CV_COACH_MAX_FLOW_COST_USD` (rige también el control compartido del agente dentro del coach: si no, el 0,30 del agente lo pisaría) |
| 45 | Turnos por charla | Llamadas a `cv_coach_turn` | 15 | `packages/pipeline/src/cv-coach/limits.ts:25` | Fijo (forma parte del esquema del estado) |
| 46 | Diagnósticos por charla | Llamadas a `cv_review` (una y un reintento) | 2 | `packages/pipeline/src/cv-coach/limits.ts:27` | Fijo |
| 47 | Fallos y repreguntas por problema | Respuestas ilegibles (2) y repreguntas (2) | 2 y 2 | `packages/pipeline/src/cv-coach/limits.ts:29`, `:31` | Fijo |

### 7. Interview

| # | Tope | Qué controla | Default | Dónde | Cambia por variable |
|---|---|---|---|---|---|
| 48 | Simulaciones por persona y día | Simulaciones que se pueden empezar en 24 h | 2 | `packages/pipeline/src/interview/limits.ts:8` (lectura `:10`; usos: `packages/adapters/src/interview/reserve.ts`, `apps/web/app/(app)/interview/server.ts`) | **Nueva:** `INTERVIEW_MAX_SIMULATIONS_PER_DAY` |
| 49 | Preguntas por simulación | Cantidad fija de preguntas | 5 | `packages/pipeline/src/interview/schemas.ts` (`INTERVIEW_QUESTION_COUNT`) | Fijo |
| 50 | Largo de una respuesta | Caracteres de una respuesta | 1.500 | `packages/pipeline/src/interview/input.ts:8` | Fijo (seguridad de entrada) |

### 8. Evaluación de ofertas y pool

| # | Tope | Qué controla | Default | Dónde | Cambia por variable |
|---|---|---|---|---|---|
| 51 | Evaluaciones por día por plan | 3 en el plan gratis, 15 en el pago (solo con `PRICING_ENABLED=1`; si no, rige el #54) | 3 y 15 | `packages/pipeline/src/plans.ts:54`, `:61` | Fijo (por plan; el tope propio del perfil `pool_daily_eval_limit` lo pisa) |
| 52 | Asignaciones al terminar el onboarding | Ofertas del pool que se asignan al empezar | 30 | `packages/pipeline/src/pool/limits.ts:18` | `POOL_FIRST_ASSIGN_LIMIT` (entero 0 a 500; 0 apaga; inválido = 30) |
| 53 | Evaluadas enseguida del onboarding | De esas, cuántas se evalúan al momento | 9 | `packages/pipeline/src/pool/limits.ts:19` | `FIRST_EVAL_TOP_N` (entero 0 a 500; inválido = 9) |
| 54 | Asignaciones diarias | Ofertas del pool asignadas por persona y día | 20 | `packages/pipeline/src/pool/limits.ts:20` | `POOL_DAILY_ASSIGN_LIMIT` (entero 0 a 500; inválido = 20) |
| 55 | Evaluaciones diarias por persona | Evaluaciones encoladas por persona y día | 3 | `packages/pipeline/src/pool/limits.ts:21` | `POOL_DAILY_EVAL_PER_USER` (entero 0 a 500; inválido = 3) |
| 56 | Mensajes de la cola por corrida | Evaluaciones que procesa cada corrida del cron (cada 6 h) | 50 | `apps/web/app/api/cron/evaluate/route.ts:30` (lectura `:58`) | **Nueva:** `EVALUATE_CRON_LIMIT` |
| 57 | Fallos seguidos | Fallas consecutivas antes de cortar la corrida | 5 | `packages/adapters/src/worker/evaluate-job.ts:792` (lectura `:796`) | `EVALUATE_MAX_CONSECUTIVE_FAILURES` (inválido = 5) |
| 58 | Presupuesto de tiempo de la corrida | Milisegundos de la corrida (la función dura 300 s) | 240.000 ms | `packages/adapters/src/worker/evaluate-job.ts:716` | Fijo (timeout) |
| 59 | Imágenes por persona y día | Avisos leídos desde imagen en 24 h | 10 | `packages/adapters/src/llm/extract-job-image.ts:14` (lectura `:58`) | **Nueva:** `IMAGE_DAILY_LIMIT` |
| 60 | Intentos de imagen por persona y día | Intentos, también los fallidos, en 24 h | 30 | `packages/adapters/src/llm/extract-job-image.ts:21` | **Nueva:** `IMAGE_ATTEMPTS_DAILY_LIMIT` |
| 61 | Puestos a la vez | Carreras que puede tener una persona en el plan gratis (el de pago: 4, en `plans.ts:65`) | 2 | `packages/pipeline/src/skills/target-roles.ts:9` (lectura `:24`) | `TARGET_ROLES_FREE_LIMIT` (entero 1 a 16; inválido = 2) |
| 62 | Ofertas cargadas a mano por persona | Total de ofertas manuales | 1.000 | `packages/pipeline/src/quota.ts:10` | Fijo (por persona) |
| 63 | Candidatas del pool | Candidatas que mira la selección por persona | 300 | `packages/adapters/src/pool/select.ts:45` | Fijo |
| 85 | Voz por persona y día | Minutos de audio transcriptos en el servidor en 24 h (reserva antes de llamar; se cuenta solo lo que respondió; además rigen los topes de USD global y por persona, `LLM_DAILY_CAP_USD` y `LLM_USER_DAILY_CAP_USD`) | 20 minutos (1.200 s) | `packages/pipeline/src/voice/limits.ts:21` (lectura `:33`; cupo en `packages/adapters/src/voice/reserve.ts`) | **Nueva (R25-03):** `VOICE_DAILY_MINUTES` (entero 1 a 1.440; inválido = 20) |
| 86 | Una grabación de voz | 120 s declarados, 2 MB y 32 kB por segundo (control contra una duración declarada de menos) | 120 s · 2 MB | `packages/pipeline/src/voice/limits.ts:13` a `:27` | Fijo (seguridad de entrada) |

### 9. Correo entrante y avisos

| # | Tope | Qué controla | Default | Dónde | Cambia por variable |
|---|---|---|---|---|---|
| 64 | Cola del pool por hora | Correos sin dueño que se aceptan por hora (el remitente se falsifica fácil) | 30 | `packages/adapters/src/inbound/pool-mailbox.ts:28` (lectura `packages/adapters/src/inbound/handle.ts:690`) | **Nueva:** `POOL_QUEUE_MAX_PER_HOUR` |
| 65 | Cola del pool por día | Ídem, por día | 200 | `packages/adapters/src/inbound/pool-mailbox.ts:29` (lectura `handle.ts:694`) | **Nueva:** `POOL_QUEUE_MAX_PER_DAY` |
| 66 | Correo crudo por persona | Bytes de correo crudo guardados por persona | 200 MB | `packages/adapters/src/inbound/handle.ts:143` | `INBOUND_MAX_BYTES_PER_USER` (1.000.000 a 100 GB; inválido = 200 MB) |
| 67 | Correo crudo por persona (otro) | Bytes de `raw_blobs` por persona (avisos, JD y emails) | 250 MB | `packages/pipeline/src/quota.ts:16` | Fijo |
| 68 | Avisos de vencimiento por día | Emails de aviso de fin de plan por día (máximo 80: Resend gratis permite 100 y se comparte) | 30 | `packages/pipeline/src/plan-expiry-notice.ts:72` (lectura `packages/adapters/src/billing/plan-expiry-notices.ts:111`) | `PLAN_NOTICE_DAILY_CAP` (entero, tope 80; inválido = 30) |
| 69 | Fallos seguidos de los avisos | Fallas de envío antes de cortar | 5 | `packages/adapters/src/billing/plan-expiry-notices.ts:73` | Fijo |
| 70 | Cupo diario de Resend (informativo) | Solo el denominador de «N de 100» en `/settings/salud`: es la cuota del plan gratis del proveedor | 100 | `packages/pipeline/src/beta-health.ts:10` | Fijo (cuota externa) |
| 71 | Comentarios por persona y día | «Contanos qué pasó» enviados en 24 h | 10 | `packages/pipeline/src/feedback/beta-feedback.ts:23` (lectura `:295`) | **Nueva:** `FEEDBACK_DAILY_LIMIT` |
| 72 | Invitaciones por tanda | Invitaciones que se mandan de una vez (máximo 100) | 20 | `packages/pipeline/src/waitlist-admin.ts:162` (lectura `:170`) | `WAITLIST_INVITE_CAP` (entero 1 a 100; inválido = 20) |

### 10. Fuentes externas y retención

| # | Tope | Qué controla | Default | Dónde | Cambia por variable |
|---|---|---|---|---|---|
| 73 | Consultas diarias a Careerjet | Consultas por día a la API del proveedor | 100 | `packages/adapters/src/pool/careerjet.ts:37` | Fijo (cuota del proveedor; un test comprueba el peor caso contra este número) |
| 74 | Consultas por corrida de Careerjet | Consultas por corrida | 15 | `packages/adapters/src/pool/careerjet.ts:40` | Fijo |
| 75 | Consultas diarias a Jooble | Ídem | 100 | `packages/adapters/src/pool/jooble.ts:26` | Fijo (ídem) |
| 76 | Consultas por corrida de Jooble | Ídem | 15 | `packages/adapters/src/pool/jooble.ts:31` | Fijo |
| 77 | Ofertas por fuente y por tablero | Máximo de ofertas por fuente (2.000) y por tablero de ATS (200) | 2.000 y 200 | `packages/adapters/src/pool/fetch.ts:87`, `packages/adapters/src/sources/ats-common.ts:269` | Fijo |
| 78 | Retroceso del pool | Días de descarga cuando una fuente no tiene corrida previa (entero 1 a 30) | 14 | `packages/adapters/src/pool/fetch.ts:154` (lectura `:725`; máximo `:161`) | `POOL_BACKFILL_DAYS` (inválido o mayor a 30 = 14) |
| 79 | Retención de correo crudo | Días que se guarda el crudo de las personas; sin valor no se borra ninguno | sin definir | `packages/pipeline/src/env-modes.ts:49`, `packages/adapters/src/retention/purge.ts:74` | `INBOUND_RAW_RETENTION_DAYS` (entero 1 a 3650) |
| 80 | Pendientes sin descripción | Días antes de limpiar un pendiente | 90 | `packages/adapters/src/retention/purge.ts:53` | Fijo |

### 11. Conexiones y base de datos

| # | Tope | Qué controla | Default | Dónde | Cambia por variable |
|---|---|---|---|---|---|
| 81 | Tokens MCP activos por persona | Tokens personales vigentes | 3 | `packages/adapters/src/mcp/auth.ts:57` | Fijo (lo muestra la pantalla `/settings/conexiones`) |
| 82 | Pedidos MCP por minuto por token | Constante definida y sin uso hoy | 60 | `packages/adapters/src/mcp/auth.ts:61` | Fijo |
| 83 | Conexiones a la base | Tamaño del pool por proceso | 5 | `packages/db/src/pool-max.ts:2` (lectura `apps/web/lib/db.ts:24`) | `DB_POOL_MAX` |
| 84 | Timeout de una llamada al modelo | Milisegundos antes de cortar una llamada | 90.000 ms | `packages/adapters/src/llm/client.ts:41` (lectura `:119`) | `LLM_CALL_TIMEOUT_MS` (número positivo; si no, 90.000) |

### 12. Límites de seguridad de entrada (listados, fijos a propósito)

No son topes de gasto ni de cupo: protegen contra entradas enormes o mal formadas. Quedan fijos.

- **Texto y campos de ofertas:** `JD_PROMPT_MAX_CHARS` 60.000, `JD_HARD_MAX_CHARS` 300.000, `PROMPT_MAX_CHARS` 120.000 y los topes por campo (`packages/pipeline/src/evaluation.ts:227` a `:275`); `MAX_PASTE_CHARS` 30.000, `MAX_JD_INPUT_CHARS` 60.000 (`packages/pipeline/src/manual-paste.ts:20`, `:27`); campos crudos 300/200 (`packages/adapters/src/ingest/clamp-fields.ts:11`).
- **CV:** archivo 5 MB, 6 páginas, texto 24.000 caracteres, DOCX inflado 5 MB, 1.000 entradas de zip, 60 candidatos (`packages/pipeline/src/cv/limits.ts:2` a `:8`).
- **Imágenes:** 5 avisos por imagen, 950.000 bytes, 5 MB de origen, 1.600 px de lado (`packages/pipeline/src/extract-image/index.ts:17` a `:26`).
- **Cuerpos de pedidos:** 120.000 (chat de CV y tarjetas), 30.000 (turno del coach), 20.000 (huecos y cierre), 8.000 (guía), 2.000 (diagnóstico), 1.000.000 (correo entrante), 262.144 (MCP) y 64 KB (asistente), en cada `route.ts` de `apps/web/app/api/` y en `packages/pipeline/src/agent/request.ts:23`.
- **Correo:** 512 KB y 2 MB por correo, 100 tarjetas por correo (`packages/adapters/src/inbound/handle.ts:123` a `:132`); 256 KB del crudo del pool (`pool-mailbox.ts:31`).
- **Comentarios:** mensaje 2.000 caracteres, contexto 4.096 bytes, 10 acciones (`packages/pipeline/src/feedback/beta-feedback.ts:17` a `:21`).
- **Tiempos de las funciones:** `maxDuration` de cada ruta (60, 120 o 300 s) y los presupuestos de los crons (`apps/web/app/api/cron/*/route.ts`).
- **Otros:** invitaciones por CSV 200 filas y 64 KB (`packages/pipeline/src/org/invite-csv.ts`), logo 100 KB (`packages/pipeline/src/org/logo.ts`), habilidades propias 30 (`packages/pipeline/src/skills/custom-skills.ts:9`).

### Resumen

- **Topes inventariados:** 86 filas (las 85 y 86, de la voz, son de la R25-03) numeradas más la familia de límites de entrada del punto 12.
- **Ya eran variables, de gasto y uso:** 17 (más cuatro de retención, infraestructura y timeout: `POOL_BACKFILL_DAYS`, `INBOUND_RAW_RETENTION_DAYS`, `DB_POOL_MAX`, `LLM_CALL_TIMEOUT_MS`) (`LLM_DAILY_CAP_USD`, `LLM_USER_DAILY_CAP_USD`, `LLM_RESERVE_MAX_CONCURRENT`, `ASSISTANT_MAX_TURNS`, `ASSISTANT_MAX_USD_PER_CONVERSATION`, `ASSISTANT_MONTHLY_CONVERSATIONS`, `CV_CHAT_DAILY_CAP_USD`, `CV_PROFILE_AGENT_DAILY_CAP_USD`, `POOL_FIRST_ASSIGN_LIMIT`, `FIRST_EVAL_TOP_N`, `POOL_DAILY_ASSIGN_LIMIT`, `POOL_DAILY_EVAL_PER_USER`, `EVALUATE_MAX_CONSECUTIVE_FAILURES`, `TARGET_ROLES_FREE_LIMIT`, `INBOUND_MAX_BYTES_PER_USER`, `PLAN_NOTICE_DAILY_CAP`, `WAITLIST_INVITE_CAP`).
- **Pasaron a variable en la R21-04 (15):** `INTERVIEW_MAX_SIMULATIONS_PER_DAY`, `CV_CHAT_MAX_COST_USD`, `CV_CHAT_USER_DAILY_CAP_USD`, `CV_CHAT_MAX_STARTS_PER_DAY`, `CV_PROFILE_AGENT_MAX_READS_PER_DAY`, `CV_PROFILE_AGENT_MAX_FLOW_COST_USD`, `CV_PROFILE_AGENT_USER_DAILY_CAP_USD`, `CV_COACH_MAX_FLOW_COST_USD`, `IMAGE_DAILY_LIMIT`, `IMAGE_ATTEMPTS_DAILY_LIMIT`, `FEEDBACK_DAILY_LIMIT`, `POOL_QUEUE_MAX_PER_HOUR`, `POOL_QUEUE_MAX_PER_DAY`, `DEMO_WEEKLY_CAP_USD`, `EVALUATE_CRON_LIMIT`.
- **Por plan (fijos, sin tocar):** `FREE_LIMITS` y `PAID_LIMITS` en `packages/pipeline/src/plans.ts:53` y `:60`, y `PERSON_QUOTA` en `quota.ts`. Cambiarlos exige rehacer la estructura de `plans.ts`: no entra en esta tanda.
- **Fijos a propósito:** reservas atadas a `model_routing`, cuotas de proveedores, límites que forman parte de un estado firmado, timeouts y límites de seguridad de entrada.

### Variables nuevas para cargar en Vercel (todas opcionales)

Sin definir, rige el default de la tabla. Todas aceptan solo un número mayor que cero; cualquier otra cosa se ignora y rige el default.

```
INTERVIEW_MAX_SIMULATIONS_PER_DAY=2
CV_CHAT_MAX_COST_USD=0.15
CV_CHAT_USER_DAILY_CAP_USD=0.3
CV_CHAT_MAX_STARTS_PER_DAY=5
CV_PROFILE_AGENT_MAX_READS_PER_DAY=3
CV_PROFILE_AGENT_MAX_FLOW_COST_USD=0.3
CV_PROFILE_AGENT_USER_DAILY_CAP_USD=0.5
CV_COACH_MAX_FLOW_COST_USD=0.3
IMAGE_DAILY_LIMIT=10
IMAGE_ATTEMPTS_DAILY_LIMIT=30
FEEDBACK_DAILY_LIMIT=10
POOL_QUEUE_MAX_PER_HOUR=30
POOL_QUEUE_MAX_PER_DAY=200
DEMO_WEEKLY_CAP_USD=1
EVALUATE_CRON_LIMIT=50
VOICE_DAILY_MINUTES=20
```

Los valores son los de hoy: copiarlos tal cual no cambia nada. Para operar, se cambia el número.

## Calculadora de margen

Sección «Calculadora de margen por plan» de `/settings/costos` (solo admin). Es un formulario GET: los valores van en la URL, se validan y acotan en el servidor, y un valor inválido vuelve al de referencia. El tipo de cambio es un campo manual (sin API). Cambiar estos valores en la pantalla **no** cambia ningún precio ni tope real: son referencias en `MARGIN_DEFAULTS` (`packages/pipeline/src/margin-calculator.ts`).

Cuenta: `margen por persona = precio × (1 − comisión) − costo de IA × tipo de cambio`, antes de impuestos propios. Punto de equilibrio = personas pagas = `fijos en ARS / margen por persona`, redondeado hacia arriba; si el margen no es positivo, «No alcanza».

| Parámetro | Valor por defecto | De dónde sale |
|---|---|---|
| Precio del plan | ARS 20.000 por mes | `docs/beta/costos-por-usuario.md` §5 (plan `lista`) |
| Tipo de cambio | ARS 1.570 por USD | ídem §2: oficial venta, dolarapi.com, 6/11/2026. **Desactualizado: se carga a mano** |
| Comisión de Mercado Pago | 6,29 % | ídem §2, Link de pago con cobro al instante; sin IVA [a confirmar] |
| Ofertas evaluadas por persona y mes | 219 | ídem §3.2, uso «medio» |
| Simulaciones de Interview por persona y mes | 4 | supuesto, sin medición |
| Charlas del coach por persona y mes | 2 | supuesto, sin medición |
| Costo por oferta | USD 0,0245 | ídem §3.5, caso B, aviso de 4 KB |
| Costo por simulación | USD 0,04 | supuesto: 1 llamada de preguntas (Haiku) + 5 devoluciones (Sonnet), sin medición |
| Costo por charla del coach | USD 0,043 | ídem §8b, uso medio (20 turnos + 1 redacción) |
| Vercel | USD 20 por mes | ídem §4, Pro |
| Neon | USD 9,89 por mes | ídem §4, Launch, 12 h activas por día |
| Otros fijos | USD 2,85 por mes | ídem §4: demo semanal 2,40 + dominio 0,45 |

Si hay datos medidos (últimos 30 días, sección «Costo por unidad»), el costo por oferta, por simulación y por charla parte de lo medido y la pantalla lo marca como «medido»; si no, usa los de esta tabla («por defecto»).

Con todos los valores por defecto: costo de IA de unos USD 5,61 por persona y mes, margen de unos ARS 9.930 (cerca del 50 %) y equilibrio en 6 personas pagas.
