# ADR-038: Coach de CV (diagnóstico y preguntas redactadas por el modelo, con temario del código)

**Status:** Accepted (17/11, decisiones de Mauro D1 a D7) · **Date:** 2026-11-17 · Amplía [ADR-026](./026-cv-redactado-por-ia-con-verificador.md) y ADR-034 (agente de perfil, rama `ronda/r11-1-agente-perfil-v2`, #514). Reabre ADR-026 §3 («la pregunta es una plantilla fija») y ADR-034 §1 («las preguntas no las redacta el modelo») **solo para el flujo del coach**. `/cv/armar` y la charla de huecos de ADR-034 no cambian de regla.

> **Decisiones de Mauro (17/11), cerradas:** D1 sí (el modelo redacta las preguntas; temario y orden del código; una llamada por turno; validador o plantilla). D2 sí (Proyectos con check y columna `link`). D3 sí (`pdfjs-dist` con versión exacta e import dinámico solo en la lectura). D4 sí (viñetas «de tu CV» solo si son substring normalizado del texto leído). D5: USD 0,30 y 15 turnos por charla, reservando siempre `cv_write`; se revisa con la Fase 3. D6: convive con `/cv/armar`, una puerta en `/cv`. D7: #514 y #511 entraron en la integración de la R11. Flag `CV_COACH` propio (`apagado | testers | all`), exige `CV_PROFILE_AGENT`, arranca en `testers`. Aceptadas también las dos reglas de R12-0: diagnóstico con plantillas del código y reserva del CV final. El contrato en código es `packages/pipeline/src/cv-coach/` (R12-7). Plan, costos y tickets: [`docs/beta/plan-coach-cv.md`](../beta/plan-coach-cv.md).

## Context
- Mauro probó «Armá tu CV con IA» el 17/11 ([informe](../beta/informe-cv-agente-17-11.md)): el chat descarta todo lo que se dice fuera del tema actual, repregunta lo ya dicho, no avisa contradicciones y no tiene dónde poner proyectos. Es lo que ADR-026 §3 decidió: un esquema estricto por tema (`cv-chat/schemas.ts:51`) y preguntas de plantilla (`cv-chat/questions.ts:14`).
- ADR-034 (#514, sin mergear) suma leer el CV y preguntar solo lo que falta, pero con plantillas fijas por carrera y sin crítica del CV contra el puesto. Además, #514 **apaga** la repregunta redactada por el modelo de R4-16: fija `followUps` en el tope antes de llamar a `cv_interview` (`adapters/src/profile-agent/gaps/turn.ts:99`).
- Lo que pide Mauro es una etapa nueva: **leer el CV, criticarlo contra el puesto objetivo y el mercado, y repreguntar para mejorarlo**, devolviendo un CV ATS mejor con un «qué mejoró».
- ADR-026 descartó «que el modelo decida qué preguntar» (auditabilidad, costo, inyección) y dejó «pregunta redactada por el modelo» **como opción si Mauro la prefiere**, con la objeción de que no entraban dos llamadas por turno en USD 0,15. Este ADR la toma con una sola llamada por turno.

## Decision

### 1. Etapas
| Etapa | Qué hace | Quién decide | Tarea (`model_routing`) |
|---|---|---|---|
| Entrada | Texto pegado (camino principal), DOCX y PDF leídos en el navegador | — | — |
| Lectura | Tarjetas por sección **con viñetas originales** y **tarjeta de proyectos** | el código normaliza y descarta | `extract_cv_profile` (v2 del prompt) |
| Diagnóstico | Lista de problemas **tipados**, cada uno apuntando a un campo | el modelo propone; el código valida referencias, suma brechas de skills desde datos, ordena y recorta | `cv_review` (nueva) |
| Charla de mejora | Una llamada por turno: extrae todo lo útil y propone la siguiente pregunta | el temario es la lista ordenada del código; la pregunta del modelo pasa un validador o cae a plantilla | `cv_coach_turn` (nueva) |
| Cierre | CV ATS con sección Proyectos y vista «qué mejoró» | verificador de ADR-026, sin cambios de regla | `cv_write` (sin cambios de fila) |

El coach **convive** con `/cv/armar` **[D6: decidido]**: una sola puerta en `/cv` («Tengo CV» lleva al coach, «No tengo CV» a `/cv/armar`). El coach se construye **sobre** el código de #514 (lectura, tarjetas, ticket, topes, flag) **[D7: decidido]**.

### 2. El modelo redacta preguntas, el código decide el temario **[D1: decidido]**
- **Qué se pregunta, en qué orden y cuándo termina** sale de la lista de problemas que ordenó el código (§4). El modelo nunca agrega temas.
- **Una sola llamada por turno** (`cv_coach_turn`): extrae y propone la próxima pregunta para el problema que el código ya eligió y le pasó en el prompt.
- **Validador de la pregunta** (puro, `pipeline/src/cv-coach/question.ts`), con el patrón de `safeFollowUpQuestion` (`cv-chat/follow-up.ts:66`):
  - una sola línea, entre 10 y 220 caracteres, con «?»;
  - sin dígitos (como R4-16; las preguntas con fechas las arma el código, §5);
  - sin links ni emails (`hasLinkOrEmail`);
  - sin datos sensibles: `SENSITIVE_QUESTION_RE` (hoy privado en `follow-up.ts:42`, se exporta);
  - sin nombres propios ni tecnologías que no estén en el CV confirmado ni en lo que dijo la persona (`cvRejectReasons` contra esas fuentes);
  - **referencia al problema**: menciona el ancla del ítem (empresa, proyecto, skill o sección).
- Si no pasa, se usa la **plantilla de respaldo** del tipo de problema (`packages/prompts/cv_coach_fallbacks.v1.md`, mismo formato y reglas que `profile_gaps.v1.md`). Nada del modelo llega a pantalla sin pasar por el validador.

### 3. Esquemas Zod
Viven en `packages/pipeline/src/cv-coach/schemas.ts`. Los nombres de campo están en inglés; los tipos de problema, en español, como pide el informe.

```ts
const itemRef = z.strictObject({
  section: z.enum(["experience", "projects", "education", "skills", "summary"]),
  itemId: z.string().max(80).regex(/^[A-Za-z0-9:_-]+$/).nullable(), // id de career_history o slug
  field: z.enum(["title", "organization", "dates", "bullets", "link", "stack", "level", "order"]).nullable(),
});

export const CV_ISSUE_TYPES = [
  "logro_sin_resultado", "tarea_vaga", "vineta_sin_verbo",
  "skill_pedida_sin_evidencia", "proyecto_sin_stack_o_link", "brecha_con_puesto",
  "fecha_faltante", "inconsistencia", "resumen_generico", "orden_poco_relevante",
] as const;

/** Salida de `cv_review`. Sin texto libre del modelo: el diagnóstico que ve la persona lo arma el código. */
export const cvReviewOutput = z.strictObject({
  issues: z.array(z.strictObject({
    type: z.enum(CV_ISSUE_TYPES),
    ref: itemRef,
    /** Cita literal del CV (opcional): tiene que ser substring normalizado del ítem; si no, se descarta la cita. */
    quote: z.string().max(200).nullable(),
    /** Skill de la taxonomía (`brecha_con_puesto`, `skill_pedida_sin_evidencia`); se valida contra `skills`. */
    skillSlug: z.string().max(60).nullable(),
    severity: z.enum(["alta", "media", "baja"]),
  })).max(15),
});

/** Salida de `cv_coach_turn`. */
export const cvCoachTurnOutput = z.strictObject({
  patch: z.strictObject({            // cambios al ítem en foco; todo opcional
    title: name.nullable(), organization: name.nullable(),
    startMonth: MONTH.nullable(), endMonth: MONTH.nullable(), isCurrent: z.boolean().nullable(),
    bullets: z.array(sentence).max(4), link: url.nullable(), stack: z.array(text(60)).max(12),
  }),
  /** Lo dicho fuera del foco: en vez de descartarse, se propone como tarjeta o saltea temas ya respondidos. */
  extras: z.array(z.strictObject({
    kind: z.enum(["proyecto", "trabajo", "logro", "fecha", "herramienta", "estudio"]),
    text: sentence,
    ref: itemRef.nullable(),
  })).max(6),
  declined: z.boolean(),             // «no tengo» / «no sé»
  nextQuestion: z.string().max(300).nullable(),
});
```

- `name`, `sentence`, `url`, `text` y `MONTH` son los de `cv-chat/schemas.ts` (se exportan; no se duplican).
- Todo lo extraído pasa por `extractionGrounded` contra el mensaje de la persona y por `hasSensitiveCvData` (como `adapters/src/cv-chat/interview.ts`). Lo que no pasa se descarta entero: falla cerrado.
- **El modelo no dice qué problema resolvió.** El código lo decide por tipo (por ejemplo, `logro_sin_resultado` queda resuelto si la persona dio una viñeta para ese ítem o dijo «no tengo»).

### 4. Diagnóstico: el código valida, completa, ordena y recorta
- **Referencias:** se descarta todo problema cuyo `ref` apunte a un ítem que no existe en lo confirmado (leído con RLS) o cuyo `skillSlug` no esté en la taxonomía.
- **Brechas de skills desde datos, no del modelo:** `skill_pedida_sin_evidencia` y `brecha_con_puesto` se calculan con `computeDemand` (`pipeline/src/skills/market.ts:23`) sobre el pool de la carrera: skills más pedidas que no aparecen en ningún trabajo ni proyecto. Lo que propone el modelo para esos tipos solo se acepta si coincide con lo que calculó el código.
- **Orden:** severidad, después prioridad fija por tipo (`brecha_con_puesto` > `skill_pedida_sin_evidencia` > `logro_sin_resultado` > `proyecto_sin_stack_o_link` > `inconsistencia` > `fecha_faltante` > `tarea_vaga` > `vineta_sin_verbo` > `orden_poco_relevante` > `resumen_generico`), después el ítem más reciente.
- **Recorte:** hasta **10** problemas por charla y hasta 3 por ítem.
- **Lo que ve la persona** («Lo que le falta a tu CV para {puesto}») son textos **de plantilla del código** por tipo, con el ancla del ítem y, si hay, la cita literal. No hay texto libre del modelo en esa pantalla.

### 5. Charla de mejora
- **Acuse armado por el código**, no por el modelo: «Anoté {empresa}, {cargo}, {mes año} a {mes año}» a partir de lo extraído y ya verificado. Puede llevar años porque sale de datos verificados (la regla «acuse sin dígitos» de ADR-026 §2 era para texto del modelo y sigue valiendo para `safeCvAck`).
- **Contradicciones:** si lo extraído choca con lo confirmado (fechas o cargo del mismo ítem), el código pregunta con plantilla: «En tu CV figura {A}, acá me decís {B}. ¿Cuál dejo?», con dos botones. No se llama al modelo.
- **Todo lo extraído sale como tarjeta para confirmar** (patrón de `ProfileGapCard`). Nada entra al CV sin el clic.
- **Cierre:** lista agotada, «Ya está, armalo», tope de turnos o tope de USD. Un problema con dos respuestas ilegibles se saltea (`CV_CHAT_MAX_FAILURES`).

### 6. Proyectos en `career_history` **[D2: decidido]**
- `career_history.kind` es un **check** (`packages/db/schema.ts:621`), no un enum: la migración (`drizzle-kit generate`) cambia el check a `('trabajo','educacion','certificacion','proyecto')`.
- Columna nueva **`link text null`** con check `link is null or link ~ '^https://'` (hasta 200 caracteres). Hace falta porque `validateHistory` rechaza links en todos los campos (`cv-out/history.ts`, `hasLinkOrEmail`).
- Para un proyecto: `organization` = nombre del proyecto, `title` = rol, `bullets` = descripción y logros, `start_month`/`end_month` opcionales. El stack va como viñeta («Stack: …»), sin columna nueva.
- **RLS:** la tabla ya tiene policy (`packages/db/rls/0014_career_history.sql`); la columna nueva la hereda. No hace falta policy nueva.
- Código que suma el tipo: `HISTORY_KINDS` (`cv-out/history.ts:10`), `CvHistoryKind` (`cv-out/model.ts:9`) con sección «Proyectos» / «Projects» en el CV, `cv-chat/state-schema.ts:30`, `cv-chat/card.ts:59`, el DOCX y el formulario de `/settings/historial`.

### 7. Lectura: viñetas originales **[D4: decidido]** y PDF **[D3: decidido]**
- `extract_cv_profile` v2 pide las viñetas de cada trabajo y proyecto. **Cada viñeta tiene que ser substring normalizado** (`foldCvText`, espacios colapsados) del texto leído, en el mismo request. Si no lo es, se descarta. La tarjeta las marca «de tu CV».
- Los proyectos salen de `facts` con `kind: "proyecto"`, que ya existen en `main` (`pipeline/src/cv/extraction.ts:49`), más los campos nuevos (rol, link, stack).
- PDF: `pdfjs-dist` con import dinámico, solo en las pantallas de lectura, con el worker como asset propio y sin `eval`. Es una dependencia nueva: carril rojo y decisión de Mauro.

### 8. Qué no se guarda (ADR-008)
- **No se guardan** el archivo, el texto del CV, la charla, la lista de problemas ni el diagnóstico.
- La lista de problemas viaja en el request, **firmada** con HMAC (subclave `cvcoach-issues-v1` de `AUTH_SECRET`, atada al `user_id` y al `flowId` del ticket de ADR-034 §5, vence a las 2 h). No lleva texto del CV salvo las citas, que el servidor vuelve a validar contra la base.
- La foto «antes» para «qué mejoró» se toma al empezar el coach (filas leídas con RLS) y vive en `sessionStorage` (`jso:coach:before`). La comparación es una función pura. Si se pierde, la vista muestra solo los problemas resueltos.
- En la base queda lo de siempre: `llm_calls` sin textos (`label = cv:<flowId>`) y lo que la persona confirma, en `career_history` con `source = 'cv'`.

### 9. Topes **[D5: decidido]** (todos fallan cerrado, mensaje fijo)
| Tope | Valor propuesto | Cómo se mide |
|---|---|---|
| Gasto por charla del coach (lectura + diagnóstico + turnos + redacción) | **USD 0,30** (el mismo de ADR-034) | suma de `llm_calls` por `label` (con `COALESCE` a la reserva, ADR-034 §6 O1) |
| Turnos de `cv_coach_turn` por charla | 15 | `llm_calls` por `label` |
| Diagnósticos por charla | 1, con un reintento si falla | ídem |
| Por persona y día / global | los de ADR-034 (USD 0,50 / `CV_PROFILE_AGENT_DAILY_CAP_USD`), compartidos | ídem |
| Reservas | lectura 0,08 · diagnóstico **0,05** · turno **0,04** · redacción 0,07 | `reserveCvChatStep`, pasos nuevos `review` y `coach_turn` |

- **La redacción queda reservada:** un turno se rechaza si lo gastado más la reserva del turno más la reserva de la redacción superan el tope por charla. Al cortar, la persona va directo al cierre con lo que confirmó, en vez de quedarse sin CV.
- Las reservas se recalculan con un test de adapters contra el seed, como `estimate.test.ts`. El costo esperado está en el plan, §3.

### 10. Ruteo y flag
- Filas nuevas en `model_routing`: `cv_review` y `cv_coach_turn`, primario `gemini-3.5-flash` con thinking `minimal` y respaldo `claude-haiku-4-5` (mismo criterio que ADR-026 §8). `cv_review`: `max_tokens` 2048. `cv_coach_turn`: 1536. El nombre del modelo solo vive en el seed.
- Prompts en `packages/prompts/`: `cv_review.v1.md`, `cv_coach_turn.v1.md` y `cv_coach_fallbacks.v1.md`, con frontmatter `version`. El CV y los mensajes entran delimitados como dato (`buildCvPromptVars`, `detectCvInjection` antes de llamar).
- Flag **`CV_COACH`** (`apagado | testers | all`; cualquier otro valor, apagado), que además exige `CV_PROFILE_AGENT` encendido para la misma persona. Lo lee una sola función, `cvCoachAllowed(env, email)`.

## Alternatives
- **Mejorar solo el chat de ADR-026** (multi-campo, acuse, proyectos) sin coach: resuelve lo que se perdía en silencio, pero no critica el CV. Va igual como Fase 1, porque sirve aunque D1 sea «no».
- **Dos llamadas por turno** (extraer y después preguntar): duplica el costo de los turnos, que es la mayor parte de la charla. Se descarta.
- **Que el modelo arme el temario:** sigue descartado (ADR-026). El modelo propone problemas tipados; el orden y el recorte son del código.
- **Diagnóstico con texto libre del modelo:** es más expresivo, pero es texto sin verificador que la persona lee como un juicio sobre su CV. Con tipos cerrados y plantillas, se audita y se traduce.
- **Guardar el diagnóstico** para retomarlo: contradice ADR-008. Si la charla se corta, se pierde (lo confirmado queda).
- **Viñetas originales reescritas por el modelo en la lectura:** pierde la garantía de «de tu CV». Se descarta; la reescritura es de `cv_write`, con verificador.
- **Leer el PDF en el servidor:** contradice ADR-034 §11 (el archivo no sale del navegador).

## Consequences
- **El coach cuesta unas 4 veces más que `/cv/armar`** (≈ USD 0,13 contra ≈ USD 0,035 típicos; plan §3), dentro del tope de USD 0,30 del agente.
- **Superficie nueva de texto del modelo en pantalla:** las preguntas. El validador y la plantilla de respaldo la acotan; la tasa de respaldo es una métrica de la Fase 3.
- **Migración** en `career_history` (check y columna `link`): carril rojo, la aplica Mauro con `pnpm db:migrate`.
- Tres prompts nuevos y una v2 de `extract_cv_profile`: cada push con prompts dispara el job de evals (≈ USD 0,16). Se juntan en un solo push por ticket.
- `cv_interview` cambia a v3 en la Fase 1 (multi-campo). La usa también la charla de huecos de #514, así que el campo nuevo es opcional con `default([])`.
- Privacidad: el diagnóstico manda el CV confirmado (no el texto crudo) al proveedor. Ya figura en lo pendiente de ADR-026 y ADR-034 para la política antes de `all`.
- El numeral 038 se revisa al integrar: 034 a 037 ya están usados en ramas abiertas (#514, R11-3, R11-4, R11-5).
