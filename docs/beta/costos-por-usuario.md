# Costos por usuario de la beta, verificados contra el código

**Fecha:** 2026-11-12 · **Código leído:** `main` en `d62cd33` (R5-C11; la versión del 2026-11-06 leía `e7e4767`) · **Alcance:** análisis de solo lectura. No se corrió seed, no se tocó ninguna base y no se usaron credenciales, así que **no hay datos reales de `llm_calls`**: los tokens salen de los prompts, de las mediciones que ya están en los docs y de supuestos marcados. Para la tarea de Notion «Verificar contra el código los costos por usuario de la beta» (entregable: cargar esto en «Costos y stack»).

**Qué cambió el 12/11.** Producción pasó `evaluate_job` a `claude-sonnet-5-5` (USD 2 entrada / 10 salida por Mtok), con respaldo `gemini-3.5-flash` (USD 1,5 / 9), `max_tokens` 8192 y thinking `low` **[D: pedido del 12/11; el seed del repo todavía dice Gemini, `max_tokens` 2048 y `minimal`; lo alinea el PR `ronda/r5-c11-routing`]**. Todo lo que dependía de la tarifa de Gemini para evaluar (§3.1 a §3.3, §5) se **recalcula en §3.5 y §5.5**; esas secciones viejas quedan como referencia de lo que valía hasta el 11/11.

**Cómo leer las marcas:** **[C]** lo dice el código (archivo:línea) · **[D]** lo dice un doc del repo o un pedido de Mauro · **[W]** página oficial consultada el 2026-11-06 (URL en §2; no se volvió a consultar el 12/11) · **[S]** supuesto mío, con su fórmula · **[?]** a confirmar por Mauro, no lo inventé.

## 0. Resumen

Con `evaluate_job` en Sonnet 5.5 (aviso de 4 KB, prompt `v1.3.4`), cotización de referencia **ARS 1.570 por dólar (oficial venta, dolarapi.com, 2026-11-06; no se actualizó: confirmar el 12/11)**. El thinking de `low` no se puede medir leyendo código: se presentan tres escenarios de salida facturada (A: sin thinking extra, B: +1.000 tokens, C: +3.000 tokens).

| Qué | Cifra | De dónde |
|---|---|---|
| Costo por evaluación (aviso de 4 KB) | **A USD 0,0145 · B 0,0245 · C 0,0445**. Techo por llamada con `max_tokens` 8192: **USD 0,092** | §3.5 |
| Costo variable por persona y mes, mezcla 60/30/10 | **A USD 3,30 · B 5,31 · C 9,33** (ARS 5.180 / 8.330 / 14.650) | §3.5 |
| Usuarios activos 10 / 25 / 50, caso B: LLM por mes | **USD 53 / 133 / 265** | §3.5 |
| Gasto global por día con 25 usuarios, caso B | **USD 4,4**: pasa el `LLM_DAILY_CAP_USD = 4` del runbook y el default de 2 (**D16**) | §3.5 |
| Costo total por usuario y mes (LLM + fijos), caso B | **N=10: USD 8,58 (ARS 13.470) · N=25: USD 6,62 (ARS 10.390) · N=50: USD 6,55 (ARS 10.290)** | §5.5 |
| Techo duro por persona (tope de código) | **USD 1 por día = USD 30 por mes** (`LLM_USER_DAILY_CAP_USD`), más que el precio | §3.4 |
| Fijos mensuales | mínimo **USD 1,6** (incumple términos de Vercel) · recomendado **USD 32,7** · alto **USD 62,3** (la demo semanal sube con Sonnet) | §4 |
| Comisión de Mercado Pago (Link de pago, cobro al instante) | **6,29 %** = ARS 1.258 por cobro de 20.000; ARS 1.522 si además lleva IVA [?] | §5 |
| Margen de contribución a ARS 20.000, todos pagan, caso B | **N=10: 26 % · N=25: 42 % · N=50: 42 %** del ingreso bruto | §5.5 |
| Referencia «USD 15» del plan | A hoy, ARS 20.000 son **USD 12,6 a 12,7**, no 15 | §5 |

Lo que más mueve el resultado: (1) el thinking de Sonnet se factura como salida a USD 10 por Mtok y es la incógnita más cara: hay que medirlo con `pnpm llm:spend` en los primeros días de tráfico; (2) los topes por plan **no** frenan las evaluaciones por email reenviado ni por pegar un aviso, solo el tope diario en USD; (3) los topes diarios de dólares de hoy (2 por defecto, 4 del runbook) quedan chicos para 25 usuarios; (4) con cobro, Vercel Hobby deja de ser una opción.

## 1. Inventario: qué consume plata

### 1.1 Modelos (tabla `model_routing`, `packages/db/seeds/model_routing.json` [C])

| Tarea | Primario → respaldo (USD por Mtok entrada/salida) | ¿Se llama en producción con datos de personas? | Dónde | Quién la dispara |
|---|---|---|---|---|
| `evaluate_job` | **Seed del repo:** gemini-3.5-flash, thinking `minimal`, `max_tokens` 2048 (1,50/9,00) → claude-haiku-4-5 (1/5) [C: `model_routing.json:2`]. **Producción desde el 12/11:** claude-sonnet-5-5 (2/10) → gemini-3.5-flash (1,5/9), `max_tokens` 8192, thinking `low` [D] | **Sí. Es el gasto principal** | `packages/adapters/src/worker/evaluate-job.ts:295`; prompt vigente `evaluate_job@v1.3.4` (`DEFAULT_PROMPT_VERSIONS`, `llm/client.ts:26`). `max_tokens` y thinking llegan del ruteo (`client.ts:156-158`) y el thinking se factura como salida (`client.ts:64`) | Cron cada 6 h (50 por corrida, `apps/web/app/api/cron/evaluate/route.ts`); evaluación inmediata al pegar JD (`apps/web/lib/evaluate-now.ts`); las 9 primeras del onboarding y los cambios de skills o puesto (`apps/web/lib/pool-reassign.ts`); asignación diaria del pool (`packages/adapters/src/pool/daily.ts`); avisos que llegan por email reenviado (`inbound/handle.ts` → cola) |
| `draft_application_answers` | claude-sonnet-5-5 (2/10) → gemini-3.5-flash (1,50/9,00) | **Sí, a pedido** (botón de borradores de un formulario, `jobs/[id]/form-review.tsx`) | `packages/adapters/src/applicant/drafts.ts:340` | La persona. Sin `ANTHROPIC_API_KEY` cae a Gemini (ADR-025) [?] |
| `cv_interview` (prompt `cv_interview@v2`, `cv-chat/interview.ts:29`), `cv_write` | gemini-3.5-flash minimal (1,50/9,00) → claude-haiku-4-5 / claude-sonnet-5-5 | **Solo con `CV_CHAT_ENABLED=all`** (opcional en el runbook §1.5); las filas hay que cargarlas a mano en Neon | `packages/adapters/src/cv-chat/{interview,write}.ts` | La persona, «Armá tu CV con IA» |
| `assistant_chat` | claude-sonnet-5-5 (2/10) → gemini-3.5-flash, `max_tokens` 600 [C: `model_routing.json:11`, agregada por R4-14; en Neon la fila la carga Mauro]. Sin fila en Neon falla cerrado (`client.ts:249`) | Solo admins y la lista de testers (`ASSISTANT_ENABLED=admin` o `testers`, `agent/gate.ts`); prompt `assistant_chat.v1` (6.340 caracteres) | `apps/web/app/api/assistant/route.ts` | Admin y testers |
| `extract_skills` | gemini-3.5-flash (1,50/9,00) | **No**. Solo la CLI `pnpm skills:extract` (`packages/adapters/src/skills/cli.ts`, `candidates-cli.ts`) | — | Mauro, a mano |
| `parse_email_fallback`, `recruiter_message`, `skill_interview`, `judge_calibration` | tienen fila | **No hay ninguna llamada** en `apps/` ni `packages/` fuera de tests y evals | — | — |
| Demo semanal | mismo evaluador, 3 perfiles inventados | Sí, fijo, no por persona | `/api/cron/demo`, lunes 07:00 UTC; tope `DEMO_WEEKLY_CAP_USD = 1` (`packages/adapters/src/demo/run.ts`) | Cron |

La tabla de la lectura de CV (`extract_cv_profile`) tampoco tiene fila ni está encendida [C, `docs/ARCHITECTURE.md` §10]: costo 0.

### 1.2 Topes que existen (todos [C])

| Tope | Valor | Qué frena | Archivo |
|---|---|---|---|
| Evaluaciones **del pool** por día, plan pago (`lista`, `fundador`, `pase_3_meses`) | **15** | Solo las que el cron de asignación encola. **Solo rige con `PRICING_ENABLED=1`**; sin la variable vale `POOL_DAILY_EVAL_PER_USER` (3) | `packages/pipeline/src/plans.ts`, `packages/adapters/src/pool/daily.ts` |
| Ídem, plan gratis | 3 | Ídem | `plans.ts` |
| Ofertas asignadas del pool por persona y día | 20 (`POOL_DAILY_ASSIGN_LIMIT`) | La asignación, no la evaluación | `packages/pipeline/src/pool/limits.ts` |
| Alta del onboarding | 30 asignadas, **9 evaluadas** (`POOL_FIRST_ASSIGN_LIMIT`, `FIRST_EVAL_TOP_N`) | Una vez por persona, **no depende del plan** | idem |
| Gasto por persona en 24 h | **USD 1** (`LLM_USER_DAILY_CAP_USD`) | **Todas** las llamadas del usuario, incluidas pegar JD, email reenviado y borradores | `packages/adapters/src/llm/spend.ts` |
| Gasto global en 24 h | USD 2 por defecto, `.env.example` también 2; el runbook sugiere **4** (`LLM_DAILY_CAP_USD`) | Todo el worker y los borradores | idem |
| Cola del cron de evaluación | 50 por corrida × 4 corridas = 200 por día | Capacidad, no gasto | `apps/web/app/api/cron/evaluate/route.ts` |
| Emails entrantes por persona | 100 por hora (sin tope diario) | Ingesta | `packages/adapters/src/inbound/handle.ts` |
| CV con IA, por persona | 40 turnos/mes; **CV por mes = máx(plan, 3): 5 con plan pago, 3 gratis**; USD 0,30/día de entrevista; 5 charlas nuevas/día; USD 0,15 por conversación; 25 turnos por charla | La charla de CV | `packages/pipeline/src/cv-chat/limits.ts`, `plans.ts` (`CV_CHAT_BETA_LIMITS`) |
| CV con IA, global | `CV_CHAT_DAILY_CAP_USD`, USD 1 por defecto (el runbook pide cargarlo a propósito) | idem | `cv-chat/limits.ts` |
| Reservas del CV (máximo por paso) | USD 0,03 por turno (R4-16, ya en `main`), USD 0,07 por redacción [C: `cv-chat/limits.ts:24-25`] | Evita pasarse con pedidos simultáneos | idem |
| Asistente | 3 charlas/mes gratis, 30 pago, USD 0,12 por conversación | Solo admins y testers (`ASSISTANT_ENABLED=testers`, `agent/gate.ts`): sin personas pagas, costo de unos pocos testers | `packages/pipeline/src/agent/limits.ts` |

### 1.3 Lo que no es LLM

| Rubro | Qué hace el código | Costo |
|---|---|---|
| Base de datos | Neon (Postgres, ADR-009). Todo vive ahí, **incluidos los crudos de email** (`raw_blobs`) y no hay S3 ni Vercel Blob [C: `packages/adapters/src/storage/blob.ts`; `docs/ARCHITECTURE.md`] | §4, §2 |
| Almacenamiento | Postgres. Los emails de remitente esperado **no se purgan por antigüedad** [D: `docs/legal/datos-por-proveedor.md` §4]; el pool dura 30 días | §4 |
| Correo | Resend: sale recuperación de contraseña, aviso de vencimiento (3 días antes), bienvenida (`WELCOME_EMAIL_ENABLED`), reportes de soporte (uno por admin). **Entra** todo el correo reenviado a `u_<token>@ingest.<dominio>` por webhook + `GET /emails/receiving/<id>` [C: `inbound/resend.ts`] | §4 |
| Hosting | Vercel (builds en cada push a `main`, funciones, ISR de 1 h en páginas públicas). Los crons los dispara **GitHub Actions** (`.github/workflows/cron.yml`), no Vercel | §4 |
| Fuentes de ofertas | Get on Board, Remote OK, Jobicy, WWR, Greenhouse/Lever/Ashby públicos: **sin API key y sin costo** en el código y en `docs/sources/*.md`. Himalayas está apagada por términos. No encontré ninguna fuente paga. Hay cláusulas de uso comercial por revisar (Jobicy, Torre) [D: `docs/sources/jobicy.md`, `torre.md`], pero no son costo | $0 |
| Cobro | Mercado Pago por **link externo** (`MP_LINK_LISTA`), sin API ni webhook; Mauro activa el plan a mano [C: `plans.ts`; D: `docs/OPERACION.md`] | comisión por cobro (§5) |
| CI/crons | El repo es **público** (verificado con la API de GitHub), así que los minutos de Actions no se cobran | $0 |
| Dominio | `afiniajobs.com.ar` en NIC.ar [D: runbook §1.3] | §4 |

## 2. Precios usados y fuentes

Consultadas el **2026-11-06**. Ninguna de las páginas muestra fecha de actualización propia, salvo donde se indica.

| Concepto | Precio | Fuente | ¿Coincide con el seed? |
|---|---|---|---|
| gemini-3.5-flash | entrada USD 1,50 · salida (incluye thinking) USD 9,00 por Mtok; Batch/Flex 0,75 / 4,50 | https://ai.google.dev/gemini-api/docs/pricing | Sí (hoy respaldo de `evaluate_job`) |
| gemini-3.1-flash-lite | 0,25 / 1,50 | idem | Sí |
| claude-sonnet-5-5 | 2 / 10 (el thinking se factura como salida) | https://platform.claude.com/docs/en/about-claude/pricing | Sí. **Primario de `evaluate_job` en producción desde el 12/11** |
| claude-haiku-4-5 | 1 / 5 (Haiku 5.5 cuesta 0,10 / 0,50 y no está en el ruteo, ADR-025) | idem | Sí |
| Vercel | Hobby USD 0 («personal, non-commercial use»); **Pro USD 20/mes** con USD 20 de crédito de uso; funciones desde USD 0,60 por millón de invocaciones; CPU activa desde USD 0,128 por hora | https://vercel.com/pricing | — |
| Neon Free | USD 0 · 100 CU-hours · **1 GB** de almacenamiento por proyecto · 5 GB de egress; al agotar CU-hours o egress **el cómputo se suspende** hasta el período siguiente | https://neon.com/pricing | — |
| Neon Launch | sin mínimo mensual · USD 0,106 por CU-hour · USD 0,35 por GB-mes · 500 GB de egress incluidos · USD 0,10/GB después | idem | — |
| Resend Free | USD 0 · 3.000 emails/mes · **100/día** · 3 dominios · sin excedente | https://resend.com/pricing | — |
| Resend Pro | USD 20/mes · 50.000/mes · sin tope diario · USD 0,90 por 1.000 extra | idem | — |
| Resend, entrantes | **la página no dice si cuentan en el cupo** (tampoco https://resend.com/docs/dashboard/receiving/introduction) | — | [?] |
| Mercado Pago, Link de pago | cobro al instante **6,29 %**; a 10 días 4,39 %; a 18 días 3,39 %; a 35 días 1,49 %. La página aclara que no incluye retenciones ni impuestos ajenos y que varía por provincia; **no dice si suma IVA** ni muestra fecha | https://www.mercadopago.com.ar/herramientas-para-vender/link-de-pago | [?] |
| Dominio `.com.ar` | ARS 8.500 por año (alta/renovación) **según una nota de enero de 2024**; NIC.ar bloquea la lectura automática | https://www.iprofesional.com/tecnologia/397387-cual-es-el-costo-de-registrar-un-dominio-en-internet-en-argentina | [?] desactualizado |
| Dólar (solo referencia, no fijo nada) | oficial venta **1.570** · mayorista venta 1.545,5 · bolsa venta 1.588 · tarjeta venta 2.041 (actualizado 2026-11-05 y 2026-11-06) | https://dolarapi.com/v1/dolares (agregador de terceros) | — |

**Parámetros de tipo de cambio** (los dejo como variables): `TC_costo` = pesos por dólar con que Mauro paga los servicios en USD; `TC_ingreso` = con el que valúa los pesos cobrados. En las cuentas de abajo uso `TC_costo = 1.570` (oficial venta) y `TC_costo = 2.041` (la cotización «Tarjeta» del agregador, por si estos servicios se pagan con tarjeta en dólares; no detalla qué impuestos incluye [?]), siempre con la fuente y fecha de arriba. Si Mauro paga con otro dólar, se recalcula con las fórmulas.

## 3. Costo variable por persona y mes (LLM)

> **§3.1 a §3.4 valen para `evaluate_job` en Gemini 3.5 Flash con thinking `minimal` (hasta el 11/11).** Los tokens de entrada, el volumen por escenario y los costos de borradores y CV siguen sirviendo; el costo por evaluación y los totales vigentes están en **§3.5**.

### 3.1 Tokens y costo de una evaluación

El prompt vigente es **v1.3.4**, de 10.561 caracteres de plantilla [C: `packages/prompts/evaluate_job.v1.3.4.md`]. Las mediciones de los docs son de v1.1 y v1.2 (3.349 y 3.933 caracteres) sobre el golden **sin texto de aviso** [D: `docs/LLM_COSTOS.md`, calibración del 2026-09-11].

- Tokens por carácter de plantilla: `(2.056 − 1.894) / (3.933 − 3.349) = 0,2774` (3,6 caracteres por token) [S: supone que la diferencia entre v1.1 y v1.2 es solo plantilla].
- Resto del prompt (perfil, restricciones, criterios, cabecera del aviso): `1.894 − 3.349 × 0,2774 = 965` tokens [S].
- **Entrada** `T_in = 10.561 × 0,2774 + 965 + JD_caracteres / 3,6 = 3.895 + JD / 3,6`.
- **Salida** medida: 418 a 433 tokens (`thinking_level: minimal` no gasta thinking) [D].
- **Costo** `C_eval = (T_in × 1,50 + T_out × 9,00) / 1.000.000`.

Control cruzado [D: `docs/adr/017-evaluador-texto-de-terceros.md`]: las 3 corridas de v1.3.4 del 07/10 costaron USD 0,348 cada una con 36 anclas, o sea **USD 0,00967 por evaluación**. Con `T_in = 3.895` (golden sin aviso) la fórmula implica una salida de 425 tokens, igual que lo medido. La cuenta cierra.

El aviso real suma tokens: la auditoría de Neon cita avisos de **4 KB en promedio** [D: `docs/neon/auditoria-consultas.md`], y el código no recorta el aviso en el prompt de evaluación (`renderJob`, `packages/pipeline/src/evaluation.ts`; el tope de 30.000 caracteres es de las funciones de idioma e inglés). Un aviso pegado puede llegar a 60.000 caracteres (`MAX_JD_INPUT_CHARS`, `manual-paste.ts`): `T_in ≈ 20.560` y **USD 0,036** esa evaluación, un caso raro pero sin tope propio.

| Escenario | Aviso (caracteres) | `T_in` | `T_out` | `C_eval` |
|---|---|---|---|---|
| Bajo | 2.000 | 4.449 | 430 | **USD 0,0105** |
| Medio | 4.000 | 5.004 | 450 | **USD 0,0116** |
| Alto | 10.000 | 6.669 | 600 | **USD 0,0154** |

Los docs usan USD 0,0068 (PRD §6, `LLM_COSTOS.md`, `capacidad.md`): es v1.3.1 (6.369 caracteres) sobre el golden sin aviso. Ver discrepancias D1 y D2.

### 3.2 Volumen por escenario (por persona, 30 días)

`N_eval = 30 × (evaluaciones del pool por día + evaluaciones por pegar aviso o email reenviado por día) + 9 del onboarding`

| | Bajo | Medio | Alto |
|---|---|---|---|
| Pool por día | 3 (default del código, o pool flaco: `capacidad.md` estima 2 a 4 ofertas nuevas por día en las carreras de la beta) | 6 (extremo alto de la misma estimación) | **15** (tope del plan pago) |
| Pegadas y emails por día (no cuentan en el tope del plan) | 0 | 1 | 10 |
| **`N_eval` por mes** | 99 | 219 | 759 |
| Borradores de formulario por mes (Sonnet 5.5: `(5.500 × 2 + 800 × 10) / 1e6 = USD 0,019`) [S] | 0 | 4 | 20 |
| CV con IA (turno `(1.200 × 1,5 + 60 × 9) / 1e6 = USD 0,00234`; redacción `(1.500 × 1,5 + 1.000 × 9) / 1e6 = USD 0,01125`) [S] | 0 | 20 turnos + 1 redacción | 40 turnos + 5 redacciones (el máximo del plan pago) |

Los tokens de borradores salen de la plantilla (3.803 caracteres) más hechos del perfil más aviso (`MAX_JD_CHARS = 8000` en `drafts.ts`) más preguntas; los del CV, de las plantillas de 3.305 y 2.789 caracteres. **No hay medición real de ninguna de las dos tareas**; `docs/LLM_COSTOS.md` estima los turnos de CV en USD 0,0015 con 4 caracteres por token y salidas del fake (**R4-16, ya en `main`**: el prompt `cv_interview@v2` (4.774 caracteres) sube la entrada de ~800 a ~1160 tokens por turno, ~USD 0,002 por turno y ~USD 0,03 a ~0,039 por CV con Gemini; las repreguntas cuentan como turno; a confirmar con `pnpm llm:spend`). Sin la clave de Anthropic, un borrador sale por Gemini: USD 0,0155.

### 3.3 Resultado

| USD por persona y mes | Bajo | Medio | Alto |
|---|---|---|---|
| Evaluaciones `N_eval × C_eval` | 99 × 0,0105 = **1,044** | 219 × 0,0116 = **2,531** | 759 × 0,0154 = **11,691** |
| Borradores | 0 | 4 × 0,019 = 0,076 | 20 × 0,019 = 0,380 |
| CV con IA | 0 | 20 × 0,00234 + 0,01125 = 0,058 | 40 × 0,00234 + 5 × 0,01125 = 0,150 |
| **Total** | **1,04** | **2,67** | **12,22** |
| Mezcla 60 % bajo, 30 % medio, 10 % alto | | **2,65** | |

Gasto global por día con 25 cuentas (15 a 20 que pagan, 3 becadas, 2 de prueba, `capacidad.md`): mezcla `25 × 2,65 / 30 = USD 2,2` por día; todas en medio, USD 2,2; todas en alto, USD 10,2. Con `LLM_DAILY_CAP_USD = 4` (runbook) el escenario alto de todos **se frena** a mitad de día.

### 3.4 Dos efectos que no son «uso»

- **Techo duro.** El único freno de las evaluaciones por email y por pegar aviso es `LLM_USER_DAILY_CAP_USD = 1` (chequeo antes de la llamada, puede pasarse por una): una persona puede llegar a **USD 30 por mes** (ARS 47.100 a 1.570), más que el precio de ARS 20.000. Es un techo, no un escenario.
- **Gratis no es USD 0.** `assignPoolDaily` recorre todos los perfiles con criterios activos sin mirar el plan [C: `pool/daily.ts`]. Quien vence queda con 3 evaluaciones por día: `3 × 30 × 0,0105 = USD 0,95` por mes por persona que ya no paga.

### 3.5 Desde el 12/11: `evaluate_job` con Sonnet 5.5, thinking `low`, `max_tokens` 8192

**Qué se sabe y qué no.**

- Tarifas [D, pedido del 12/11, coinciden con §2]: Sonnet 5.5 USD 2 entrada / 10 salida por Mtok; respaldo Gemini 3.5 Flash USD 1,5 / 9.
- Entrada: la misma fórmula de §3.1, `T_in = 3.895 + aviso / 3,6` (v1.3.4 sin cambios, `client.ts:26`): **4.449 / 5.004 / 6.669** tokens para avisos de 2 / 4 / 10 KB. Es un conteo con el tokenizador de Gemini [S]; el de Anthropic puede dar más tokens para el mismo texto [?], y cada +10 % de entrada suma ≈ USD 0,001 por evaluación.
- Salida: el thinking `low` **se factura como salida** (`client.ts:64`: `outputTokens` ya incluye el thinking) y **no tengo ninguna medición** de cuánto razona Sonnet 5.5 en `low` con este prompt [?]. Antes (`minimal`) la salida medida era 418 a 433 tokens y no había thinking [D: `LLM_COSTOS.md`]. Tres escenarios [S]:
  - **A:** `low` casi no razona: salida facturada = la visible de antes (430 / 450 / 600).
  - **B:** `low` agrega 1.000 tokens de razonamiento.
  - **C:** `low` agrega 3.000 tokens.
- Techo por llamada: con `max_tokens` 8192 una llamada que agote el presupuesto cuesta `5.004 × 2 + 8.192 × 10 = USD 0,092` (aviso de 4 KB). Si la salida se corta, el JSON falla el parseo y la evaluación se reintenta o va al respaldo, pagando dos veces (`error-code.ts:64`).

`C_eval = (T_in × 2 + T_out × 10) / 1.000.000`

| Aviso | `T_in` | A | B | C |
|---|---|---|---|---|
| 2 KB | 4.449 | 0,0132 | 0,0232 | 0,0432 |
| **4 KB** | 5.004 | **0,0145** | **0,0245** | **0,0445** |
| 10 KB | 6.669 | 0,0193 | 0,0293 | 0,0493 |

**Por persona y mes**, con los mismos escenarios de uso de §3.2 (bajo 99 evaluaciones, medio 219, alto 759; bajo con aviso de 2 KB, medio de 4 KB y alto de 10 KB) y los mismos borradores y CV de §3.3 (medio USD 0,134, alto USD 0,530 por mes; bajo 0). USD:

| Uso | A | B | C |
|---|---|---|---|
| Bajo | 1,31 | 2,30 | 4,28 |
| Medio | 3,31 | 5,50 | 9,88 |
| Alto | 15,21 | 22,80 | 37,98 (pasa el tope de USD 30 por mes: el tope de 1 por día frena antes) |
| **Mezcla 60 / 30 / 10** | **3,30** | **5,31** | **9,33** |

**Por escenario de usuarios activos** (mezcla; USD por mes; entre paréntesis, gasto global por día = mes / 30):

| Usuarios activos | A | B | C |
|---|---|---|---|
| 10 | 33 (1,10) | 53 (1,77) | 93 (3,11) |
| 25 | 82 (2,75) | 133 (4,42) | 233 (7,77) |
| 50 | 165 (5,50) | 265 (8,85) | 466 (15,55) |

**Lo que esto implica para los topes** [C: `spend.ts:28` y `:41`]:

- `LLM_DAILY_CAP_USD` por defecto es 2 y el runbook sugiere 4. Con 25 usuarios en el caso B el gasto medio ya es USD 4,4 por día: el cron de evaluación se frena por tope todos los días y las evaluaciones pendientes pasan al día siguiente. Con 10 usuarios y el caso B (USD 1,8 por día) el default de 2 queda justo. **D16.**
- `LLM_USER_DAILY_CAP_USD` = 1 equivale a 40 evaluaciones por día por persona en el caso B (`1 / 0,0245`) y a 22 en el C. El alta del onboarding (9 evaluaciones) cuesta USD 0,13 a 0,40 por persona, una vez.
- La demo semanal (3 perfiles, tope `DEMO_WEEKLY_CAP_USD = 1` en `demo/run.ts:32`) usaba USD 0,26 por corrida con Gemini [D: comentario de `cron.yml`]; con la tarifa nueva escala ×2 aprox. [S: razón `0,0245 / 0,0116`], unos USD 0,55 por corrida y USD 2,4 por mes, con tope duro de 4,33.
- **Respaldo.** Si Anthropic no responde o `ANTHROPIC_API_KEY` no está cargada, el proveedor primario queda «no disponible» (`providers.ts:26-31`) y la llamada va al respaldo Gemini (`client.ts:274-288`) con el mismo thinking `low`: el costo vuelve a ser el de Gemini con thinking (la salida también se factura a USD 9), no más barato que el caso A. Una falla de parseo por corte (`max_tokens`) paga el primario y el respaldo.

## 4. Costos fijos mensuales

| Rubro | Mínimo | Recomendado | Alto | Fórmula y nota |
|---|---|---|---|---|
| Vercel | 0 (Hobby) | **20** (Pro) | 20 | [W] Hobby es «personal, non-commercial use»: con cobro corresponde Pro. El crédito de USD 20 incluido probablemente cubre las funciones: **a confirmar en *Usage*** [?] |
| Neon | 0 (Free) | **9,89** (Launch, 12 h activas por día) | 19,43 (24 h) | Launch: `0,25 CU × horas_activas × 0,106 + 1 GB × 0,35`; `12 h × 30 = 360 h → 90 CU-h → 9,54 + 0,35`; `24 h → 720 h → 180 CU-h → 19,08 + 0,35`. [S: mínimo de 0,25 CU]. **Riesgo del Free:** 100 CU-hours = 400 h a 0,25 CU, y al agotarlas **se suspende el cómputo** (la app cae). Los crons cada 6 h y las visitas pueden mantener la base despierta más de 400 h; ningún doc lo estima [?] |
| Resend | 0 (Free) | 0 (Free) | 20 (Pro) | Pro solo si los entrantes cuentan en el cupo de 100/día [?] o si se supera. Salientes: recuperación (~25/mes) + vencimientos (~25) + bienvenida (~25) + soporte, bien debajo de 3.000/mes |
| Demo semanal | 1,13 | 2,40 | 2,40 | Mínimo: `0,26 × 52 / 12` (USD 0,26 por corrida con Gemini, comentario de `cron.yml`). Con Sonnet 5.5 (§3.5): `0,55 × 52 / 12 = 2,38` [S]; tope duro `1 × 52 / 12 = 4,33` |
| Dominio | 0,45 | 0,45 | 0,45 | `ARS 8.500 / 12 / 1.570` con una tarifa de 2024 [?] |
| GitHub Actions, fuentes, monitores gratis (UptimeRobot / Better Stack) | 0 | 0 | 0 | |
| **Total** | **1,58** | **32,74** | **62,28** | Con la demo a tarifa Sonnet (antes 31,47 y 61,01). Total recomendado `20 + 9,89 + 0 + 2,40 + 0,45 = 32,74`; alto `20 + 19,43 + 20 + 2,40 + 0,45 = 62,28` |

**Almacenamiento por persona** [S, a medir con `docs/neon/neon-stats.sql`]: emails reenviados `90 por mes × 10 a 35 KB` (las fixtures reales de `inbound/fixtures` miden 4 a 33 KB) = 0,9 a 3,2 MB; avisos propios `200 × (4 KB de aviso + 3 KB de evaluación)` = 1,4 MB. Total **2 a 5 MB por persona y mes**, o 40 a 100 MB por mes con 20 personas, contra 1 GB del Free [W]. El pool (3.000 a 6.000 avisos de 30 días, `auditoria-consultas.md`) suma unos 20 a 40 MB. No es un costo mientras dure el Free, pero los crudos de email no se purgan.

**Neon, transferencia:** `capacidad.md` estima 1,5 a 4 GB por mes contra 5 GB del Free (cotas de ese doc, no las remedí). En Launch vienen 500 GB incluidos: ahí el egress no es costo.

**Peso por persona de los fijos** (`F / N`, USD; entre paréntesis ARS a 1.570). Con los fijos de 12/11 (recomendado 32,74; alto 62,28):

| | Mínimo | Recomendado | Alto |
|---|---|---|---|
| N = 10 | 0,16 (248) | **3,27** (5.140) | 6,23 (9.778) |
| N = 25 | 0,06 (99) | **1,31** (2.056) | 2,49 (3.911) |
| N = 50 | 0,03 (50) | 0,65 (1.028) | **1,25** (1.956) |

(a 50 usuarios se usa la columna «alto»: Resend Free no alcanza con 100 a 200 correos entrantes por día si cuentan en el cupo [?] y Neon trabaja más de 12 h.)

## 5. Margen

### 5.1 Cuenta por persona

`margen_persona = P × (1 − c_MP) − costo_variable_USD × TC_costo`, con `c_MP = 6,29 %` (7,61 % si suma IVA [?]). Es margen de contribución, **antes de fijos, impuestos propios y monotributo**.

| Costo variable en ARS (USD × TC) | Bajo | Medio | Mezcla | Alto |
|---|---|---|---|---|
| TC_costo 1.333 (el implícito de «USD 15») | 1.392 (7,0 %) | 3.552 (17,8 %) | 3.530 (17,6 %) | 16.291 (81,5 %) |
| TC_costo 1.570 | 1.639 (8,2 %) | 4.184 (20,9 %) | 4.157 (20,8 %) | 19.187 (95,9 %) |
| TC_costo 2.041 | 2.131 (10,7 %) | 5.439 (27,2 %) | 5.405 (27,0 %) | 24.943 (124,7 %) |

(el porcentaje es sobre ARS 20.000).

| Margen de contribución por persona (ARS), TC_costo 1.570 | Bajo | Medio | Mezcla | Alto |
|---|---|---|---|---|
| P = 20.000 | 17.103 | 14.558 | 14.585 | **−445** |
| P = 15.000 (hipótesis de precio fundador) | 12.417 | 9.872 | 9.899 | −5.130 |
| P = 10.000 (50 % de 20.000) | 7.732 | 5.187 | 5.214 | −9.816 |
| P = 7.500 (50 % de 15.000) | 5.389 | 2.844 | 2.871 | −12.159 |
| P = 0 (becado) | −1.639 | −4.184 | −4.157 | −19.187 |
| TC_costo 2.041, P = 20.000 | 16.611 | 13.303 | 13.337 | −6.201 |

Los planes con descuento y la beca **tienen los mismos topes** que un pagante completo (`PAID_LIMITS`, `plans.ts`); no existe en el código un plan «50 %» ni un precio fundador (`priceArs: null`, `listed: false`). Cada beca cuesta lo mismo que un pagante.

### 5.2 Precio de equilibrio por persona (ARS)

`P_eq = (costo_variable_USD + F / N) × TC_costo / (1 − c_MP)`

| | TC 1.570 | TC 2.041 |
|---|---|---|
| Solo variable, uso mezcla | 4.436 | 5.767 |
| Variable + fijos recomendados, N = 15 | 7.951 | 10.337 |
| Variable + fijos recomendados, N = 20 | 7.073 | 9.194 |
| Una persona en uso alto, solo variable | 20.475 | 26.617 |
| Precio para 50 % de margen, mezcla, fijos recomendados (todos pagan igual): `P = c / (0,5 − c_MP)` | N = 15: 17.047 · N = 20: 15.163 | N = 15: 22.161 · N = 20: 19.712 |

Una sola persona en uso alto cuesta lo mismo que el precio completo.

### 5.3 Cohorte: 1 becado + 2 al 50 % + el resto a precio completo

`ingreso = (N − 3) × P + 2 × 0,5 × P = (N − 2) × P` · `margen = ingreso × (1 − c_MP) − (N × costo_variable_USD + F) × TC_costo` (todas las cuentas consumen; las 2 de prueba no están contadas).

P = 20.000, fijos recomendados (USD 31,47). ARS y % del ingreso:

| | Bajo | Medio | Mezcla | Alto |
|---|---|---|---|---|
| N = 15, ingreso 260.000, TC 1.570 | 169.652 (65 %) | 131.477 (51 %) | 131.878 (51 %) | −93.566 (−36 %) |
| N = 20, ingreso 360.000, TC 1.570 | 255.166 (71 %) | 204.267 (57 %) | 204.801 (57 %) | −95.791 (−27 %) |
| N = 15, TC 2.041 | 147.454 (57 %) | 97.827 (38 %) | 98.347 (38 %) | −194.730 (−75 %) |
| N = 20, TC 2.041 | 230.510 (64 %) | 164.340 (46 %) | 165.034 (46 %) | −225.735 (−63 %) |

Sensibilidad a los fijos (mezcla, TC 1.570): mínimos **N = 15: 178.805 (69 %) · N = 20: 251.728 (70 %)**; altos **N = 15: 85.500 (33 %) · N = 20: 158.423 (44 %)**. Con P = 15.000 para todos (hipótesis), fijos recomendados, TC 1.570, mezcla: N = 15 → 70.966 (36 %); N = 20 → 120.462 (45 %). Con TC 2.041 y fijos altos, N = 15, P = 15.000 el uso medio ya da pérdida (−23.376).

### 5.4 Combos hipotéticos

No conozco la composición de los combos de Ani; estos dos son **ilustrativos** (precios inventados para mostrar la cuenta), con el mismo costo variable por mes.

| Combo hipotético | Precio | Cómo es en el código | Margen de contribución (TC 1.570) bajo / medio / mezcla / alto |
|---|---|---|---|
| A. Mensual, precio lista | ARS 20.000 por 30 días | plan `lista` (`MP_LINK_LISTA`) | 17.103 / 14.558 / 14.585 / −445 por mes |
| B. Trimestral con 10 % menos | ARS 54.000 por 90 días (= 18.000 por mes) | plan `pase_3_meses` (`priceArs: null`, no listado, `MP_LINK_PASE_3_MESES`) | 45.997 / 38.362 / 38.442 / −6.647 por los 3 meses (15.332 / 12.787 / 12.814 / −2.216 por mes). Resta las 9 evaluaciones de onboarding que se pagan una vez |

Con TC 2.041, el combo B da 44.615 / 34.690 / 34.794 / −23.822 por los 3 meses. Un pago único trae un riesgo extra: el uso alto de los meses 2 y 3 no se compensa con ingresos nuevos.

### 5.5 Recalculado con `evaluate_job` en Sonnet 5.5 (12/11)

> §5.1 a §5.4 usaron el costo de Gemini (§3.3). Valen como referencia de la estructura de la cuenta, no como números vigentes.

Cotización de referencia: **ARS 1.570 por dólar, oficial venta, dolarapi.com, 2026-11-06** (la última que tengo; no pude consultarla el 12/11: **a actualizar por Mauro**). Comisión de Mercado Pago 6,29 % (sin IVA [?]) → neto por cobro de ARS 20.000: **ARS 18.742**. Cohorte simplificada: **todas las personas pagan el precio completo** (sin becado ni descuentos, que cuestan lo mismo que un pagante, §5.1); fijos de §4 (recomendados a 10 y 25 usuarios, altos a 50).

`margen = N × 18.742 − N × variable_ARS − fijos_ARS` · variable por persona (mezcla, §3.5): A ARS 5.178, B ARS 8.334, C ARS 14.645 · fijos: ARS 51.402 (N = 10 y 25) y 97.780 (N = 50).

| Usuarios activos | Ingreso bruto | Margen A | Margen B | Margen C |
|---|---|---|---|---|
| 10 | 200.000 | 84.238 (42 %) | 52.678 (26 %) | **−10.432 (−5 %)** |
| 25 | 500.000 | 287.698 (58 %) | 208.798 (42 %) | 51.023 (10 %) |
| 50 | 1.000.000 | 580.420 (58 %) | 422.620 (42 %) | 107.070 (11 %) |

Precio de equilibrio por persona (`(variable + F / N) × 1.570 / (1 − 0,0629)`, ARS): A **11.010 / 7.721 / 7.613**, B **14.378 / 11.088 / 10.980**, C **21.113 / 17.823 / 17.715** (N = 10 / 25 / 50). En el caso C con 10 usuarios el precio de ARS 20.000 no cubre el costo.

Costo total por usuario y mes (LLM + fijos), en dólares y en pesos a 1.570:

| Usuarios activos | A | B | C |
|---|---|---|---|
| 10 | 6,57 (10.318) | 8,58 (13.474) | 12,60 (19.785) |
| 25 | 4,61 (7.235) | 6,62 (10.390) | 10,64 (16.702) |
| 50 | 4,54 (7.134) | 6,55 (10.290) | 10,57 (16.601) |

Un solo usuario en uso alto del caso B cuesta USD 22,80 por mes (ARS 35.800), más que el precio: los topes por plan no lo frenan (§3.4); solo el tope de USD 1 por día.

## 6. Discrepancias entre los docs y el código

| # | Qué dice el doc | Qué hace el código | Impacto |
|---|---|---|---|
| D1 | `docs/PRD.md` §6 («USD 0,0068 por evaluación → USD 4,08 a 20/día»), `docs/LLM_COSTOS.md` (tabla «Costo mensual proyectado», 1.800 tokens de entrada) y `docs/beta/capacidad.md` §1 usan USD 0,0068 | El prompt vigente es **v1.3.4** (10.561 caracteres, +66 % sobre v1.3.1) y el aviso real viaja entero. Medido en golden sin aviso: USD 0,00967; con aviso de 4 KB: ≈ USD 0,0116 | La métrica «< USD 5» del PRD a 20 por día pasa a **USD 6,9 por mes**. Todas las proyecciones de esos docs quedan bajas un 40 a 130 % |
| D2 | `capacidad.md` §1: peor caso de 345 evaluaciones por día = USD 2,35 por día; ≈ USD 110 por mes; `LLM_DAILY_CAP_USD = 4` «cubre el peor caso» | `345 × 0,0116 = USD 4,0`; `345 × 0,0154 = USD 5,3` por día; USD 120 a 160 por mes solo en evaluaciones | El tope de 4 se alcanza en el peor caso: lo no evaluado se atrasa un día |
| D3 | `capacidad.md` §1 suma `extract_skills` («una por oferta nueva del pool», ≈ USD 0,20 a 0,35 por día) | No hay llamada productiva: solo la CLI `pnpm skills:extract`. `docs/legal/datos-por-proveedor.md` §3 lo dice bien | Sobran ≈ USD 6 a 10 por mes del costo estimado |
| D4 | `capacidad.md` §1: `parse_email_fallback` «solo si el parser falla, ≈ USD 0,0005» | No tiene ninguna llamada; un parser que falla manda el email a la cola manual (`CLAUDE.md`) | Costo 0 |
| D5 | `capacidad.md` §1 y `plans.ts`: «15 por día (Beta) y 3 (gratis)» como tope por persona | Solo limita las evaluaciones del pool que encola el cron, y solo con `PRICING_ENABLED=1`. Pegar un aviso (`evaluate-now.ts`) o reenviar alertas (`inbound/handle.ts`) no cuenta; solo frena `LLM_USER_DAILY_CAP_USD` (USD 1 por día) | El peor caso por persona no es `15 × C_eval` sino USD 30 por mes |
| D6 | `plans.ts`: «Gratis: lo que queda cuando termina tu mes, con menos ofertas por día» | La asignación diaria sigue para todos los perfiles con criterios activos; el gratis evalúa 3 por día | ≈ USD 0,95 por mes por persona vencida |
| D7 | Runbook §1.5: «Tope por persona: 3 CV y 40 turnos por mes» | `cvChatBetaCvPerMonth = máx(plan, 3)` y `getUserPlan` no depende de `PRICING_ENABLED`: **plan pago = 5 CV por mes**; gratis o vencido = 3 | Más uso posible en el plan pago (ya contado en «alto») |
| D8 | `capacidad.md` §5 y runbook §3.2 asumen Vercel **Hobby**; `docs/DEPLOY.md` opción 4: «Pro no se justifica hoy» | Con cobro en pesos corresponde Pro [W: Hobby es «personal, non-commercial use»] | +USD 20 por mes en fijos, previsto en §4 |
| D9 | `docs/AUDITORIA_2026-09-11.md` #12: «Neon Free de 0,5 GB». `capacidad.md` §3 solo mira el egress | La página de Neon dice hoy **1 GB** por proyecto y **100 CU-hours**; al agotar cualquiera de los dos topes el cómputo se suspende o se bloquean las escrituras | Falta estimar CU-hours; es el riesgo operativo más alto de seguir en Free |
| D10 | `docs/DEPLOY.md` opción 3: «los minutos de Actions de un repo privado alcanzan» | El repo es público: Actions no se cobra | Ninguno |
| D11 | `plans.ts` da 3/30 charlas por mes de asistente y `limitsText` las lista si `enabled.assistant` | El asistente es solo admin y testers (`ASSISTANT_ENABLED=admin` o `testers`, `agent/gate.ts`); `assistant_chat` tiene fila en el seed desde R4-14 (en Neon falla cerrado hasta que Mauro la cargue) | Hoy no se vende; no hay que mostrarlo en el combo |
| D12 | `plans.ts` (`priceUsdRef: 15`), runbook y `OPERACION.md`: ARS 20.000 = USD 15 | Implica 1.333 pesos por dólar. Con las cotizaciones de §2, ARS 20.000 son USD 12,59 a 12,74 (bolsa y oficial venta) y USD 9,80 a tarjeta | La referencia en dólares sobrevalora el precio 18 a 19 % |
| D13 | Runbook y notas hablan de «precio fundador» y «50 %» | `fundador` y `pase_3_meses` tienen `priceArs: null` y `listed: false`; hay una sola variable de pago listada (`MP_LINK_LISTA`). Un descuento es otro link de Mercado Pago más una activación manual como «Pagó» | Sin ADR ni código para precios por persona |
| D14 | Runbook §2.3: «si pasa de USD 1,5 en un día, mirá de quién es» | Con 25 cuentas, el uso medio ya gasta USD 2,2 por día | El umbral de alerta saltaría todos los días; conviene 3 a 4 |
| D15 | `.env.example` y `spend.ts`: `LLM_DAILY_CAP_USD` = 2 por defecto | Si Mauro no carga el 4 del runbook, el uso medio de 25 cuentas ya lo toca | Ver D14 |
| D16 | Runbook y `capacidad.md`: `LLM_DAILY_CAP_USD` = 4 «cubre» a 25 cuentas | Con `evaluate_job` en Sonnet 5.5 (12/11) el gasto medio de 25 cuentas es USD 2,8 a 7,8 por día según cuánto razone `low` (§3.5) | El 4 se alcanza todos los días en el caso B. Subirlo a 6 a 8 o medir primero con `pnpm llm:spend` |
| D17 | `model_routing.json:2` (seed): Gemini, `max_tokens` 2048, `minimal` | Producción usa Sonnet 5.5, 8192 y `low` desde el 12/11 | Seed desalineado; lo corrige el PR `ronda/r5-c11-routing` (sin aplicar nada en Neon) |

## 7. Los 11 puntos de `pasos-manuales-r4.md` §9, respondidos con el código (12/11)

Qué responde el código, qué queda como supuesto y qué tiene que confirmar Mauro. Ningún dato de esta tabla sale de una base ni de una consola.

| # | Punto | Lo que dice el código | Estado |
|---|---|---|---|
| 1 | Tokens reales por evaluación (`evaluate_job@v1.3.4`) | Cada llamada guarda `tokens_in`, `tokens_out` y `tokens_reasoning` en `llm_calls` (`llm/spend.ts:22-24`, `llm/types.ts:39-41`); `tokens_out` ya incluye el thinking (`client.ts:64`). Con la fórmula de §3.1 la entrada es 5.004 tokens para un aviso de 4 KB [S]. **La salida con Sonnet 5.5 y thinking `low` no se puede deducir del código** (§3.5: tres escenarios) | **A confirmar por Mauro** con `pnpm llm:spend --days 7` o `/settings/metricas` tras unos días con tráfico: es el número que más mueve el costo |
| 2 | Comisión de Mercado Pago: ¿suma IVA? | El cobro es un link externo (`MP_LINK_LISTA`, `plans.ts:104`), sin API ni webhook: el código no ve la comisión | **A confirmar por Mauro** con un cobro real. Se usa 6,29 % [W, 6/11] y se marca 7,61 % si lleva IVA |
| 3 | Resend: ¿los entrantes cuentan en el cupo de 100 por día? | Los correos reenviados **entran** por webhook y `GET /emails/receiving/<id>` (`inbound/resend.ts`); tope de 100 por hora por persona (`inbound/handle.ts`), sin tope diario. Las salidas (recuperación, vencimientos 3 días antes, bienvenida, soporte) son pocas decenas por mes. Si cuentan, el volumen es el de los reenvíos de las alertas | **A confirmar por Mauro** (consola de Resend o soporte). Ni el código ni la página de precios lo dicen |
| 4 | Plan de Vercel y Neon; CU-hours | Los crons los dispara GitHub Actions (`.github/workflows/cron.yml`): ingesta y evaluación cada 6 h (4 por día), mercado y demo los lunes, avisos de plan a las 12:15 UTC; no usan los crons de Vercel. La evaluación procesa hasta 50 mensajes por corrida (`api/cron/evaluate/route.ts:23`, 200 por día). Neon es la única base (ADR-009). El código no dice en qué plan están | **A confirmar por Mauro** (Billing y Monitoring de cada consola). Con cobro, Vercel Hobby no corresponde [W] |
| 5 | `ANTHROPIC_API_KEY` en producción y filas `cv_*` en Neon | Sin la clave, el proveedor Anthropic queda «no disponible» (`llm/providers.ts:26-31`) y cada llamada cae al respaldo (`client.ts:274-288`); **desde el 12/11 eso incluye `evaluate_job`**. Sin fila en `model_routing`, la tarea falla cerrado con `no_route` (`client.ts:247-251`); el seed no se corre contra Neon (`CLAUDE.md`), así que `cv_interview`, `cv_write` y `assistant_chat` están solo si Mauro las cargó | **A confirmar por Mauro** (variables de Vercel; consulta de solo lectura a `model_routing`) |
| 6 | Valores de `PRICING_ENABLED`, `LLM_DAILY_CAP_USD`, `LLM_USER_DAILY_CAP_USD`, `CV_CHAT_ENABLED`, `CV_CHAT_DAILY_CAP_USD` | Defaults sin variable: `LLM_DAILY_CAP_USD` 2 (`spend.ts:28`), `LLM_USER_DAILY_CAP_USD` 1 (`spend.ts:41`), `CV_CHAT_DAILY_CAP_USD` 1 (`cv-chat/limits.ts:115`), `CV_CHAT_ENABLED` apagado salvo `all` o `admin` (`limits.ts:123-126`), `PRICING_ENABLED` apagado: el tope del plan no rige y vale `POOL_DAILY_EVAL_PER_USER` = 3 (`pool/limits.ts:21`, `pool/daily.ts:80-86`). Con Sonnet, §3.5 recomienda `LLM_DAILY_CAP_USD` de 6 a 8 para 25 usuarios | **A confirmar por Mauro** (qué hay cargado) |
| 7 | Costo real de un turno de CV, una redacción y un borrador | Sin cambios de código desde el 6/11 salvo el prompt `cv_interview@v2` (4.774 caracteres): ≈ USD 0,002 a 0,0023 por turno y 0,011 por redacción con Gemini; borrador de USD 0,019 con Sonnet o 0,0155 por Gemini [S, §3.2]. El tope de reserva por turno subió a USD 0,03 (`cv-chat/limits.ts:24`) | **Supuesto.** Medir con `pnpm llm:spend` tras charlas de prueba |
| 8 | Tarifa del dominio `.com.ar` | No está en el código | **A confirmar por Mauro** (NIC.ar). El dato del doc es de enero de 2024 |
| 9 | Tipo de cambio con que paga los servicios en dólares | No está en el código. Referencia usada: oficial venta ARS 1.570 (6/11) y «tarjeta» 2.041 | **A confirmar por Mauro** (y actualizar la cotización del 12/11) |
| 10 | Facturación activa de la clave de Gemini | No está en el código. Desde el 12/11 Gemini es el respaldo de `evaluate_job` y el primario de CV, `extract_skills` y de las demás tareas de Gemini | **A confirmar por Mauro** (consola de Google) |
| 11 | Impuestos propios, cuentas de admin y prueba, horas de trabajo | No está en el código | **A confirmar por Mauro** con su contador/a |

### 7.1 Lista original del 6/11 (referencia)

1. **Tokens reales por evaluación con v1.3.4 y avisos reales.** Se obtienen con `pnpm llm:spend --days 7` o `/settings/metricas` (por tarea y modelo) en cuanto haya tráfico. La longitud media de aviso (4 KB) viene de un doc.
2. **IVA en la comisión de Mercado Pago** y fecha de la tarifa: la página oficial muestra 6,29 % sin decir si lleva IVA ni cuándo se actualizó (probar con un cobro real en *Actividad*). Retenciones provinciales e impuestos propios del cobro, fuera de esta cuenta.
3. **Resend: ¿los entrantes cuentan en el cupo?** Ni la página de precios ni la guía de recepción lo dicen. Con 25 personas hay 50 a 100 por día [D: `capacidad.md`]; si cuentan, el Free (100 por día) se agota y hace falta Pro.
4. **Plan actual de Vercel y de Neon** (¿Hobby o Pro?, ¿Free o Launch?) y el **consumo de CU-hours de Neon** en *Monitoring*.
5. **Si `ANTHROPIC_API_KEY` está cargada en producción** (define si los borradores salen por Sonnet o por Gemini) y **si `cv_interview`/`cv_write` existen en `model_routing` de Neon** (el seed del repo no se corre contra Neon).
6. **Valores reales de `PRICING_ENABLED`, `LLM_DAILY_CAP_USD`, `LLM_USER_DAILY_CAP_USD`, `CV_CHAT_ENABLED` y `CV_CHAT_DAILY_CAP_USD`** en Vercel.
7. **Costo de turnos y redacción de CV y de borradores**: estimados sin red; falta una medición con llamadas reales (`docs/LLM_COSTOS.md`, «Armá tu CV con IA»).
8. **Dominio:** tarifa vigente de NIC.ar (la única que encontré es de enero de 2024).
9. **Dólar de costos:** con qué tipo de cambio paga Mauro los servicios en USD (la cotización «tarjeta» de dolarapi.com es de un agregador de terceros, no oficial).
10. Facturación activa de la clave de Gemini (`docs/legal/datos-por-proveedor.md` ya lo marca).
11. Impuestos propios (monotributo, ingresos brutos), cuentas de admin y prueba, horas de trabajo: no están en estas cuentas.

## 8. Palancas, por si el margen no alcanza (no implementadas; carril rojo)

- **Tope por plan también para las evaluaciones por pegar aviso y email reenviado**, o bajar `LLM_USER_DAILY_CAP_USD` a 0,30 a 0,50 (con Sonnet 5.5, `0,30 / 0,0245 ≈ 12` evaluaciones por día en el caso B).
- **Ver cuánto razona `low`** antes de abrir la beta: una corrida de prueba de las 9 evaluaciones del onboarding con `pnpm llm:spend` (columna thinking). Si el caso C se confirma, bajar el thinking a `minimal` o `none` en `model_routing` vuelve al costo del caso A sin tocar código.
- **Dejar de asignar y evaluar a los planes vencidos** o bajarles el tope de pool a 1.
- **Modo Batch/Flex de Gemini** para la cola del cron (USD 0,75 / 4,50 contra 1,50 / 9,00 [W]): el worker es asíncrono, así que el costo de evaluación podría bajar a la mitad. A medir contra el golden.
- **Prompt más corto:** la plantilla pesa 2.930 de los ~5.000 tokens de entrada; cada 1.000 caracteres menos ahorran ≈ USD 0,0004 por evaluación.

## 9. Cómo se reproduce

1. Constantes: `packages/db/seeds/model_routing.json`, `packages/pipeline/src/plans.ts`, `packages/pipeline/src/pool/limits.ts`, `packages/adapters/src/llm/spend.ts`, `packages/pipeline/src/cv-chat/limits.ts`.
2. Tamaños de prompt: `wc -c packages/prompts/*.md`.
3. Fórmulas: las de las tablas; las cuentas se hicieron con un script de Python de una pasada sin dependencias, no incluido en el repo.
4. Las cuentas de §3.5, §4 y §5.5 se rehicieron el 12/11 con las fórmulas de las tablas (aritmética a mano, sin script).
5. Con datos reales: `pnpm llm:spend --days 7`, `/settings/metricas`, `docs/neon/neon-stats.sql` (solo lectura) y los paneles de Neon, Vercel y Resend. Nada de eso se corrió para este documento.
