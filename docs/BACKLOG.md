# Backlog

Tickets de 1–3 hs. `deps` = tickets que deben estar done. Estado: `todo` · `doing` · `done`. Cada ticket lleva criterio de aceptación verificable. Diseñados para ejecutarse con Claude Code (Opus) sin contexto adicional: cada ticket dice qué archivos toca.

## Bloque 1 — Fundaciones (viernes 11)

### JS-001 · Monorepo y tooling
`deps:` — · `est:` 1.5 h · `estado:` done (2026-09-10)
- pnpm workspaces + Turborepo; `apps/web` (Next.js 15, TS strict, Tailwind), `packages/{db,pipeline,adapters,prompts}`, `evals/`.
- ESLint + Prettier compartidos; `pnpm lint|typecheck|test|build` en raíz.
- `.nvmrc`, `.editorconfig`, `.gitignore` con `.env*`.
- **Acepta:** `pnpm install && pnpm build` verde en limpio.

### JS-002 · Docker Compose local
`deps:` JS-001 · `est:` 0.5 h · `estado:` done (2026-09-10)
- `infra/docker-compose.yml`: `postgres` (pgvector/pgvector:pg16, puerto 54322). `localstack` (s3, sqs) queda comentado hasta fase 3 (ver `docs/AWS_MIGRATION_PLAN.md`).
- `pnpm db:up`, `pnpm db:down`.
- **Acepta:** `pnpm db:up` levanta `postgres` healthy y `psql` conecta con la extensión `vector` disponible. LocalStack fuera del criterio hasta fase 3.

### JS-003 · Schema Drizzle y migración inicial
`deps:` JS-002 · `est:` 1.5 h · `estado:` done (2026-09-10; aplicada en Docker. En nube se aplica en JS-019, pendiente decisión Supabase/Neon)
- Copiar `packages/db/schema.ts` del repo docs; `drizzle.config.ts`; `drizzle-kit generate` → migración 0000.
- `packages/db/rls/0000_policies.sql` con policies de `docs/SCHEMA.md`.
- Script `pnpm db:migrate` que aplica migraciones + RLS.
- **Acepta:** migración aplica en Docker y en Supabase; `select * from jobs` como usuario B no ve filas de A (test en JS-009).

### JS-004 · Seeds
`deps:` JS-003 · `est:` 1 h · `estado:` done (2026-09-10)
- `pnpm db:seed`: `skills.json`, `model_routing.json`, `criteria.mauro.json` (user de Mauro), perfil de Mauro, `talent_platforms` iniciales.
- Cargar `evals/fixtures/golden.json` como `jobs` + `evaluations(model='human')` + `applications` con outcomes.
- **Acepta:** 34 jobs, 31 evaluaciones humanas, 60 skills en DB.

### JS-005 · Adapter LLM y loader de prompts
`deps:` JS-003 · `est:` 1.5 h · `estado:` done (2026-09-10)
- `packages/adapters/llm`: `generateStructured(task, schema, vars)` con Vercel AI SDK, proveedor según `model_routing`, fallback en error, registro en `llm_calls` (tokens, latencia, costo estimado).
- `packages/prompts/loader.ts`: lee `.md`, parsea frontmatter, interpola `{{vars}}`.
- `FakeLlm` para tests.
- **Acepta:** llamada real a `gemini-3.5-flash` con `evaluate_job@v1` devuelve JSON válido para el job 33; fila en `llm_calls`.

### JS-006 · Harness de evals
`deps:` JS-005 · `est:` 2 h · `estado:` done (2026-09-10)
- `evals/run.ts`, `metrics.ts`, `compare.ts` según `evals/README.md`.
- `pnpm evals run --prompt evaluate_job@v1 --model gemini-3.5-flash` y también con `gemini-2.5-flash`.
- **Acepta:** reporte con MAE, recall de bloqueadores, acc de disciplina/acción. Si MAE > 1.0 → abrir JS-006b "ajustar prompt v1.1" con los 5 jobs de mayor delta.

## Bloque 2 — Pipeline puro (sábado 12)

### JS-007 · Normalización de empresa y título
`deps:` JS-001 · `est:` 1 h · `estado:` done (2026-09-10)
- `normalizeCompany()` (lower, sin sufijos legales, sin "vía X"), `normalizeTitle()` (sin seniority, stopwords, paréntesis), `canonicalUrl()` (sin utm/tracking, LinkedIn `currentJobId` → `/jobs/view/{id}`).
- **Acepta:** tests con los 34 títulos/empresas del golden; Empresa F ×2 normaliza a la misma empresa.

### JS-008 · Dedup
`deps:` JS-007 · `est:` 2 h · `estado:` done (2026-09-10)
- `dedup(candidate, recentJobs)` → `{kind:'merge', jobId} | {kind:'insert'}` según ADR-006. Jaccard de título, shingles 5-gramas de JD.
- **Acepta:** `dedup_pairs` del golden pasan; flag `volume_recruiting` en el par 19/20.
- **Fix 2026-09-18 (ADR-013):** empresa+título dejó de fusionar (fusionó dos avisos distintos de una consultora y el JD de uno pisó al otro). Ahora fusionan URL, external_id, `jd_hash` o texto ≥ 0.9; empresa+título solo marca `posible_duplicado` + `duplicate_of_id`. Regresiones en `packages/pipeline/src/dedup/fixtures/regressions.json`.

### JS-009 · Test de integración RLS
`deps:` JS-003 · `est:` 1 h · `estado:` done (2026-09-10; adelantado por el hallazgo de RLS: FORCE + rol jobsearch_app + control negativo)
- Testcontainers Postgres; dos usuarios; inserta jobs para A; verifica que B no lee/escribe.
- **Acepta:** test verde en CI.

### JS-010 · Prefiltro
`deps:` JS-007 · `est:` 2 h · `estado:` done (2026-09-10)
- `prefilter(job, rules: CriteriaRules)` → `{pass:true} | {pass:false, reason}` con solo campos de email: título (blocklist/allowlist/cap), modalidad, ubicación vs países, badge de aptitudes, candidatos, keywords de disciplina en título.
- **Acepta:** `prefilter_expectations` del golden: `must_discard` descartados, `must_pass` pasan, id 13 cap 5, ids 18/31 por badge.

### JS-011 · Decide y máquina de estados
`deps:` JS-010 · `est:` 1 h · `estado:` done (2026-09-10)
- `decide(evaluation, rules)` → `accion`; aplica cap de título, penalizaciones verificables (años, cloud must, inglés fluent), bloqueadores → descartar.
- `transition(status, event)` con transiciones válidas de `docs/SCHEMA.md`.
- **Acepta:** tests de `decide` del doc de testing; transición inválida lanza.

### JS-012 · Ingesta Get on Board
`deps:` JS-008, JS-010 · `est:` 2 h · `estado:` done (2026-09-10)
- `adapters/sources/getonboard.ts`: API pública, categorías programming + data + ai (confirmar slugs), `remote=true`, últimas 24 hs; mapea a `RawJob` (salario, tags, seniority, países).
- Route `app/api/cron/ingest-getonboard` protegido por `CRON_SECRET`; `vercel.json` cron cada 6 hs.
- Pipeline: dedup → prefiltro → (jd presente en GoB → cola evaluar).
- **Acepta:** corrida manual inserta ofertas reales; segunda corrida no duplica.

### JS-013 · Cola y worker de evaluación
`deps:` JS-005, JS-011 · `est:` 1.5 h · `estado:` done (2026-09-10; cola y worker verificados con FakeLlm; corrida real pendiente de créditos Gemini)
- `adapters/queue/pgmq.ts` (enqueue/dequeue/ack); route `app/api/cron/evaluate` procesa hasta 20 mensajes; guarda `evaluations`; `decide` → `jobs.status`.
- **Acepta:** ofertas de GoB quedan `evaluada` con score y acción.

## Bloque 3 — UI mínima y CI (domingo 13)

### JS-014 · Auth y layout ✅ done 2026-09-11
`deps:` JS-003 · `est:` 1.5 h
- ~~Supabase Auth~~ Auth.js con Credentials (ADR-010; email+password, un solo usuario creado por el seed con `SEED_USER_EMAIL`/`SEED_USER_PASSWORD`). Layout con nav: Ofertas · Pendientes de JD · Postulaciones · Mercado (placeholder). La app se conecta con `DATABASE_URL_APP` y verifica que el rol no pueda saltear RLS; cada request corre con `SET LOCAL app.user_id` (`lib/db.ts#withUser`).
- **Acepta:** login funciona; sin sesión redirige. Probado en Docker: `/jobs` sin sesión → `/login`; contraseña incorrecta muestra error; correcta → `/jobs` con nav; con el rol dueño la app falla con `AppRoleError`.

### JS-045 · Recuperar contraseña por email y setup inicial ✅ done 2026-09-16
`deps:` JS-014 · `est:` 1.5 h
- Pedido directo de Mauro, fuera de la secuencia del backlog. `password_reset_tokens` (token de 32 bytes, se guarda hasheado sha256, vence en 1 h, un solo uso; RLS: lectura abierta como `users`, escritura por dueño vía `withUser`). Envío por Resend REST (`packages/adapters/src/email/resend.ts`, sandbox `onboarding@resend.dev` sin dominio propio verificado). `/forgot-password` y `/reset-password` públicas (`auth.config.ts`); nunca revela si el email existe. Detalle en ADR-012.
- **Setup inicial** (toca ADR-010, ver aclaración en ADR-012): `/setup` reemplaza el `pnpm db:seed` manual por una pantalla, pero SOLO mientras `users` está vacía — no es registro público. Doble candado: `hasAnyUser()` en la app + policy RLS `users_bootstrap_insert` (`WITH CHECK (NOT EXISTS (SELECT 1 FROM users))`). `/login` rebota a `/setup` sin usuario y viceversa; crear la cuenta deja logueado.
- **Acepta:** login con link "Olvidé mi contraseña"; pedir el link no dice si el email existe; el link vence en 1 h y no sirve dos veces; contraseña nueva exige 8+ caracteres y confirmación; con la tabla `users` vacía, `/login` lleva a `/setup` y crear la cuenta loguea directo; con un usuario ya creado, `/setup` no deja crear otro. Tests: unit (`password-reset-token.test.ts`, `email/resend.test.ts`), e2e (`05-recuperar-contrasena.spec.ts`, `06-setup-inicial.spec.ts`).
- Queda fuera: `RESEND_API_KEY` todavía no está cargada (ni local ni en Vercel) — sin ella el token se crea pero no se manda el mail; rate limit de pedidos por email/IP (hoy no hay, un solo usuario).

### JS-015 · Lista de ofertas ✅ done 2026-09-11
`deps:` JS-013, JS-014 · `est:` 2 h
- Server Component: tabla/cards con score, empresa, título, fuente, estado, `location_ok`, flags; filtros por score mín, fuente, estado, fecha (search params). Ordena por score desc, fecha desc.
- Mobile-first; Framer Motion solo para transiciones de lista.
- **Acepta:** usable desde el celular; filtro persiste en URL. Hecho: `lib/jobs.ts#listJobs` (última evaluación por job con `selectDistinctOn`, fuentes agregadas, filtros `score`/`fuente`/`estado`/`desde` en search params, default "activas"), cards con score, estado, fuentes, ubicación, bloqueadores (rojo) y riesgos (ámbar) separados; Framer Motion solo en `job-list.tsx`; filtros en `job-filters.tsx` (client) que reescriben la URL.

### JS-016 · Detalle y acciones ✅ done 2026-09-11
`deps:` JS-015 · `est:` 1.5 h
- Página `/jobs/[id]`: evaluación completa (match, gaps, bloqueadores, veredicto), fuentes, botones de estado (Server Actions con `transition`). Campo "score humano" + nota → `evaluations.human_score`.
- **Acepta:** cambiar estado y cargar score humano persisten. Hecho: `/jobs/[id]` con bloqueadores (rojo, frenan) y riesgos (ámbar, se ven) separados, match/gaps/señales/veredicto, ajustes de `decide()`, fuentes con link, JD plegable; botones solo con los eventos válidos (`availableEvents`) vía Server Actions que llaman `transition()` (`lib/job-detail.ts`); `apply` deja fila en `applications`; score humano + nota en `evaluations.human_score/human_note`. Probado en Docker.

### JS-017 · Cola pendiente de JD ✅ done 2026-09-11
- `/jobs/pending-jd`: lista ≤ 10 con link a la oferta; textarea "pegar JD" → guarda `jd_text`, encola evaluación. Botón "cerrada" → estado `cerrada`.
- Snippet de instrucción para Claude in Chrome en la página ("Extraé el texto completo de la descripción del puesto...").
- **Acepta:** pegar JD → evaluación aparece en < 1 min. Hecho: `/jobs/pending-jd` (≤ 10, link al aviso, textarea, botón Cerrada vía `transition`), `lib/pending-jd.ts#attachJd` guarda `jd_text/jd_hash/jd_shingles` y encola con `enqueueEvaluationWith` bajo RLS; snippet para Claude in Chrome con botón copiar. El worker salta ofertas cerradas después de encolar. El "< 1 min" depende de que corra el worker: en Vercel es el cron (ver JS-019, límites del plan Hobby); local `pnpm worker:evaluate --local`. Probado en Docker hasta la cola (sin créditos LLM no se corrió el worker real).

### JS-018 · GitHub Actions ✅ done 2026-09-11
`deps:` JS-006, JS-009 · `est:` 1 h
- `ci.yml` según `docs/TESTING_STRATEGY.md`. Evals solo si cambian `packages/prompts/**` o `evals/**`.
- **Acepta:** PR muestra checks verdes. Hecho: jobs lint-typecheck, unit, integration (Postgres pgvector), build (`next build` sin base) y evals (solo PR con cambios en prompts/evals; subset de 14 llamadas, `--concurrency 1 --db none --max-usd 0.5`; si falta el secret `GEMINI_API_KEY` se saltea con `::warning`, nunca falla). No hay remoto todavía: los checks se ven cuando el repo suba a GitHub.

### Deuda técnica registrada

- **2026-09-15 · Primer deploy: los prompts no viajaban en el bundle de Vercel.** El loader leía los `.md` relativo al módulo compilado; en serverless eso apunta al chunk y los `.md` no se incluían. El primer cron ingirió 12 ofertas de Get on Board y las 12 evaluaciones fallaron con `prompt not_found` (sin gasto: falla antes de llamar al modelo). Arreglo: `outputFileTracingIncludes` en `next.config.ts` y `resolvePromptsDir()` busca también relativo al cwd, con test. Además `cron.yml` falla en rojo si toma mensajes y no evalúa ninguno (antes quedó verde con 12 de 12 reintentadas).

- **2026-09-11 · Agujero cerrado: riesgo de ubicación en la carga manual y por MCP.** `toRawJob` ponía `countriesAllowed: ["*"]` para todo remoto, así que el prefiltro nunca marcaba `location_risk` en lo cargado a mano o por MCP (justo lo que viene de LinkedIn). Ahora `rawJobFromManual` (pipeline) deja países en null y un remoto sin ubicación escrita queda como "remoto (sin país indicado)" → riesgo. Test de integración de los tres caminos (GoB, manual/MCP, JD pegada después) en `worker.integration.test.ts`; unitario en `raw-job.test.ts`.

- **2026-09-11 · Calibración cerrada (paso E):** primario `gemini-3.5-flash` con `thinking_level: minimal` y `max_tokens` 2048, prompt de producción `evaluate_job@v1.2`, USD 0,0068 por evaluación medido. flash-lite no pasó el criterio (blockers_recall 75 %); números, hipótesis v1.3 y diagnóstico de `location_risk_recall` 50 % y `action_acc` 64 % en `docs/LLM_COSTOS.md`. Pendiente de Mauro: decidir qué se corrige en el golden (Empresa O 16, Empresa A 1), qué en `decide()` (`location_ok = no` → tope guardar) y qué en el prompt (modalidad fuera de `location_ok`).
- **2026-09-11 · Calibración CERRADA (tercera tanda):** prompt `evaluate_job@v1.3.1` en producción, `gemini-3.1-flash-lite` primario con `gemini-3.5-flash` de fallback (USD 0,0013/eval), ADR-011 (disciplina hunde el score, modalidad no). Harness: `promptVersionNumber` lee mayor.menor, `applyLocationCap` compartido con `decide()`, recall de ubicación cuenta "no". Residual: flash-lite no marca "LATAM sin países" (lo cubre el flag `location_risk` del prefiltro). Lo que sigue se calibra con ofertas reales (JS-036).
- **2026-09-11 · Segunda tanda de calibración:** golden corregido (16, 1), `decide()` con tope guardar para `location_ok = no`, prompt v1.3 escrito y medido (tabla en LLM_COSTOS.md); producción sigue en v1.2 × 3.5-flash hasta que Mauro decida. `pnpm worker:requeue [--local] (--model fake | --job <id>) [--force]` re-encola ofertas evaluadas (CLI a propósito, no UI).
- **2026-09-11 · Mensaje huérfano en `job_queue` (RESUELTO):** un job borrado por los E2E dejó su mensaje encolado; el worker lo marca "job inexistente" y lo devuelve a pending hasta agotar `max_attempts`. Ahora `queue.fail(id, error, { final: true })` lo cierra en el primer intento.

- **2026-09-11 · FK `profiles.user_id → users.id` diferida** (ADR-010, JS-014). El aislamiento lo dan las policies RLS por `user_id`; la FK solo suma integridad referencial. Cerrarla: migración con `.references(() => users.id)` en `profiles.userId` (Docker y Neon ya tienen la fila de `users`) e insertar el usuario en los tests de integración (`worker.integration.test.ts`, `rls.integration.test.ts`). Decisión de Mauro: esperar; no bloquea el deploy.

### JS-019 · Deploy a Vercel + Neon prod ✅ done 2026-09-15
`deps:` JS-018 · `est:` 1 h
- Proyecto Vercel, envs, cron activo, migraciones aplicadas en Neon (ADR-009), `GET /api/health`.
- **Acepta:** producción evaluando ofertas de GoB sola.
- Hecho: `GET /api/health` (base + rol sin BYPASSRLS, 503 con motivo), `docs/DEPLOY.md` con variables, pasos y los límites del plan Hobby. **Desplegado el 2026-09-15**: proyecto `job-search-os` (root `apps/web`, Node 22), repo de GitHub conectado (push a `main` despliega), variables cargadas por CLI, migraciones y seed en Neon, producción en `https://job-search-os-kohl.vercel.app` y cron de GitHub Actions con `APP_URL`. Falta el DNS del subdominio propio (registro en DEPLOY.md).

## Bloque 4 — Ingesta por email (semana 2)

### JS-020 · Inbound email (Resend) ✅ configurado 2026-09-18
`deps:` JS-019 · `est:` 2 h
- **Producción:** dominio `ingest.malejo.com.ar` verificado en Resend con envío **y recepción**; registros en la zona de Vercel (DKIM, SPF, MX de feedback en `send.ingest`, y **MX de recepción** `ingest MX 10 inbound-smtp.sa-east-1.amazonaws.com`, que tiene que ser el de menor prioridad del subdominio). Webhook `https://busquedalaboral.malejo.com.ar/api/inbound` con `RESEND_WEBHOOK_SECRET` e `INGEST_DOMAIN` cargados. `profiles.inbound_address` = `u_a0000000@ingest.malejo.com.ar` por **UPDATE puntual**: el seed completo NO se corre contra producción, reescribiría perfil y golden.
- Verificado contra producción: 401 sin firma, 401 con firma inválida, 200 `unknown_recipient` con firma válida, y el primer email real (confirmación de reenvío de Gmail) guardado y despachado a cola manual como corresponde.
- **`/inbox/<id>`: ver el contenido del email** (links, texto y HTML en un `iframe` con `sandbox` vacío, porque es contenido no confiable). Nació de una carencia real: sin esto, un email de una fuente nueva caía en cola manual y no había forma de leerlo para decidir si cargarlo a mano o escribirle un parser. El primer caso fue el link de confirmación de Gmail, que estaba enterrado en el HTML.
- **✅ Confirmado en producción con datos reales el 2026-09-18:** llegaron dos alertas reales de LinkedIn por el filtro de reenvío de Gmail, el parser extrajo 5 y 1 avisos, y el dedup no duplicó: un mismo puesto de Empresa X (golden id 30) re-anunciado dos veces quedó como un solo job, y Empresa S (golden id 24) se cruzó con el job del golden cargado antes. (La sospecha de que el filtro de Gmail no andaba era falsa: faltaba que llegara una alerta real después de crearlo.)
- **Hecho 2026-09-11 (infra, sin parsers):** `POST /api/inbound` con verificación Svix obligatoria (`verifySvix`, sin dependencia; 401 sin firma), evento `email.received`, cuerpo vía `GET /emails/receiving/{id}` con `RESEND_API_KEY`, crudo en `raw_blobs` (adapter `storage` sobre Postgres, RLS), fila en `inbound_emails`, despacho por remitente (`chooseParserName`: linkedin | getonboard | generic), idempotencia por `email_id`, rate limit 100/hora por usuario. Sin parser o estructura no reconocida → cola manual (`/inbox`, link a `/jobs/new`). Tests: unit (firma) + integración (storage, fila, duplicado, destinatario desconocido, rate limit). Pasos de configuración en `docs/DEPLOY.md`.
- **Investigación 2026-09-11 (antes de escribir código):** el plan Free de Resend incluye recepción ("All plans include: … inbound emails"; 3.000 emails/mes, 100/día, 3 dominios, retención 30 días); funciona con registros MX en un subdominio (`ingest.<tu-dominio>`) y un webhook firmado (Svix) que avisa `email.received`; el cuerpo se pide por API. Alternativa: Cloudflare Email Routing + Email Worker (gratis, 25 MiB por mensaje, 200 reglas; el Worker recibe el MIME crudo y puede hacer `fetch` al webhook propio, con límites de CPU del plan Free; requiere el DNS del dominio en Cloudflare). Decisión pendiente de Mauro.
- Dominio `ingest.<dominio>`, webhook `POST /api/inbound` con verificación de firma, guarda crudo en storage, fila en `inbound_emails`, despacha por remitente.
### JS-021 · Parser LinkedIn ✅ done 2026-09-17
`deps:` JS-020 · `est:` 2 h
- `inbound/linkedin.ts`: las alertas de empleo traen un aviso por tarjeta `data-test-id="job-card"`, con el id en `/jobs/view/<id>/` y la línea "Empresa · Ubicación (Modalidad)". Extrae título, empresa, ubicación, modalidad, badges (lista blanca: lo que no reconoce lo ignora, así el pie del email no entra) y URL canónica. `countriesAllowed` queda **null** (la alerta no dice desde qué países se contrata) para que el prefiltro marque riesgo de ubicación; `jdText` null → pendiente_jd.
- **Aptitudes y candidatos no están en las alertas**: no se inventan, quedan null. Vienen en otros formatos de email de LinkedIn (JS-022 o después).
- **Falla cerrado, email entero**: sin HTML, sin tarjetas o con una tarjeta que no se entiende → `{ ok: false }` y a la cola manual. No hay extracción parcial.
- Fixtures anonimizadas en `inbound/fixtures/linkedin/` (5 alertas reales + 2 negativos), solo el fragmento del aviso: sin nombre, email, titular del perfil ni tokens de tracking; empresas y títulos ficticios. Los `.eml` crudos quedan en `fixtures-private/email/`. `.prettierignore` las excluye para que el formateo no altere lo que prueban.
- **Acepta:** 29 tests unitarios sobre 10 fixtures (8 alertas con 17 avisos, 1 de recomendaciones con 4, y 1 negativo), **cobertura 100 %** de `linkedin.ts` en líneas, sentencias, funciones y ramas (`pnpm --filter @job-search-os/adapters test:coverage`). Validado contra los 16 emails reales: 17 de 17 avisos extraídos con campos correctos. Flujo real probado de punta a punta con un `.eml` original contra la base local (`handleInboundEmail`, el mismo código del webhook): la oferta queda en `pendiente_jd` con título, empresa, ubicación, modalidad, badges y URL canónica correctos.
- **Ojo con la ubicación de las alertas:** LinkedIn muestra la zona de búsqueda del usuario ("Argentina", "Salta"), no los países desde los que contrata el aviso. Por eso `countriesAllowed` queda null y la decisión real se toma al evaluar con la JD pegada; no confiar en `locationRaw` como si fuera el país del puesto.
- **Segundo formato cubierto (2026-09-17):** *recomendaciones* ("Amplía tu búsqueda", `jobs-noreply@`). Misma tarjeta, ancla `...JOBS_POSTING_SECTION-job-cards`: el parser acepta las dos y distingue la fuente (`alerta «X»` vs `recomendaciones «X»`, la búsqueda sale del asunto o del cuerpo). Aporta los casos de modalidad **Híbrido** y de tarjeta **sin modalidad**, que las alertas no traían. Sobre los 16 emails reales: 21 avisos extraídos (17 alertas + 4 recomendaciones).
- **Gap conocido — *empleos guardados* ("Solicita tus empleos guardados", anclas `featured-saved-job` / `other-saved-jobs-job-card-N`): se deja fuera a propósito.** Son avisos que el usuario **ya guardó** en LinkedIn, o sea que en su mayoría ya están en la base: entrarían como duplicado y el trabajo del parser se lo comería el dedup. Además varias tarjetas vienen sin modalidad y el valor real del email es "este aviso sigue abierto", que es otra cosa (señal de vigencia, no ingesta). Cubrirlo tendría sentido recién si se quiere usar esa señal para marcar ofertas cerradas, y ahí conviene un parser propio, no estirar el de alertas. Mientras tanto cae en la cola manual, que es el comportamiento correcto.
### JS-022 · Parser Get on Board (email) y genérico ✅ done 2026-09-21
`deps:` JS-020 · `est:` 1.5 h · `estado:` done
- **Get on Board, `inbound/getonboard.ts`:** cubre los dos formatos reales. **Selección de empleos**: tarjetas `class="job"` con título, "Seniority | Contrato", empresa y salario en USD/mes. **Empleos destacados**: un `<h1>` con "Título | Seniority", la empresa en el `<strong>` anterior y el contrato después; la descripción que trae viene recortada ("...") y no se usa como JD. Si un email trae los dos, se juntan sin repetir.
- **Cruce con el cron:** los links vienen envueltos en un tracker y codificados. El aviso se identifica por el slug de `/empleos/<categoría>/<slug>`, que es el mismo id de la API. La URL se arma como la publica la API (`https://www.getonbrd.com/jobs/<slug>`, verificado contra producción) para que el dedup fusione por URL canónica: si el cron ya lo trajo, se suma la fuente y el JD se conserva; si el email llega primero, entra en `pendiente_jd` y el cron lo completa después.
- **Falla cerrado:** sin HTML, sin avisos, o con un aviso sin empresa o título, con seniority o contrato fuera de la lista conocida, o con salario ilegible → email entero a la cola manual. Lo que el email no dice queda null: ubicación, `countriesAllowed`, modalidad (`desconocida`), JD, candidatos y fecha. El sufijo `-remote` del slug **no** se usa para inferir modalidad.
- **Genérico: se deja sin registrar, a propósito.** Revisado en producción el 2026-09-21: ninguno de los 33 emails que no son de LinkedIn trae datos estructurados de oferta (JobPosting en JSON-LD o microdata), así que un parser genérico tendría que adivinar empresa y título, y eso contradice fallar cerrado. Además, registrarlo cambiaría `parser = 'none'` por `generic` y apagaría la alarma "sin parser" de `/inbox` (JS-038). Lo desconocido sigue en la cola manual; cada fuente nueva lleva su parser propio (ver JS-047).
- **Tests:** 25 unitarios sobre 2 fixtures anonimizadas (`inbound/fixtures/getonboard/`, empresas y títulos ficticios, sin nombre ni tokens de tracking), con 100 % de líneas de `getonboard.ts`. Además, 2 de integración (`getonboard.integration.test.ts`: webhook → fusión con el aviso del cron en los dos órdenes, y cada aviso apunta al crudo del email). Validado contra el email real de `fixtures-private/`: 2 de 2 avisos con todos los campos correctos.
### JS-023 · Ingesta manual (URL + texto) ✅ done 2026-09-11
`deps:` JS-017 · `est:` 1 h
- `/jobs/new` (formulario, Server Action) y tool MCP `add_job`: mismo `ingestRawJob` que las fuentes automáticas (dedup 14 días por URL o JD; empresa+título solo marca posible duplicado desde ADR-013, prefiltro, cola si trae JD; sin JD queda en pendientes de JD), fuente `manual`, bajo RLS (policy `companies_insert` para crear la empresa). Probado: alta por UI (pendiente de JD) y por MCP (insert y luego merge por URL).

### JS-024 · Guardar el crudo de toda carga en `raw_blobs`, sea cual sea la vía ✅ done 2026-09-21
`deps:` JS-020, JS-023 · `est:` 2 h · `estado:` done (PR #7, en producción 2026-09-21 17:46 UTC; nació del incidente de dedup, ADR-013)
- **Por qué:** una fusión errónea pisó el JD de un aviso (Empresa E, ver ADR-013) y solo se recuperó porque Neon guarda 6 h de historial. Fue suerte, no una garantía del sistema.
- **Estado actual:** solo la ingesta por email guarda el crudo (`raw_blobs` + `inbound_emails.raw_ref`). No lo guardan la carga manual (`/jobs/new` y MCP `add_job`, `rawRef: null` en `rawJobFromManual`), Get on Board (`rawRef: null` en `sources/getonboard.ts`), ni el JD pegado después en pendientes de JD (`apps/web/lib/pending-jd.ts`). Además, fusionar conserva "el texto más largo" y descarta el otro sin dejar rastro.
- **Hacer:** antes de normalizar o hacer dedup, guardar el payload original en `raw_blobs`: el input manual como JSON, el item de la API de GoB y el JD pegado. `job_sources.raw_ref` apunta al blob. Al fusionar, el JD que no queda en `jobs.jd_text` sigue accesible por la `raw_ref` de su fuente.
- **Acepta:** test de integración por vía (manual, MCP, GoB, pendiente de JD) donde cada `job_sources` tiene `raw_ref` que resuelve a un blob con el texto original; test de merge donde se recuperan los dos JD desde sus fuentes.
- **Implementado (2026-09-18):** `RawJob.source.original` lleva el payload tal como llegó (input manual sin trim, item de la API de GoB con su HTML). `ingestRawJob` lo guarda en `raw_blobs` (`kind = ingest_<fuente>`) **antes del dedup**; si el adapter no trae payload, guarda el RawJob mismo, así ninguna vía queda sin crudo. Cada `job_sources.raw_ref` apunta al blob. Si la misma fuente vuelve con el mismo contenido (el cron de GoB re-trae los avisos cada 6 h) se reusa el blob y no se agrega fila; si el contenido cambió, va una fila nueva con su blob; una fuente anterior a JS-024 sin crudo se completa la próxima vez que llega. El JD pegado en pendientes (`attachJdText`, ahora en adapters) se guarda crudo (`kind = jd_pegada`) en una fuente propia "JD pegada". **Hueco que apareció:** la ingesta por email guardaba el email pero no lo enlazaba en los avisos extraídos (`raw_ref` null); ahora cada aviso apunta al crudo del email. Tests: unitarios (manual y GoB conservan el original) y 8 de integración en `packages/adapters/src/ingest/raw.integration.test.ts`.
- **Fuera de alcance:** los jobs cargados antes de JS-024 no tienen crudo (no hay de dónde sacarlo); los de GoB se completan solos mientras sigan publicados.
- **Bug que destapó el CI (ya existía):** `loadRecentJobs` solo traía los jobs de los últimos 14 días, así que un aviso con la misma URL o el mismo id de la fuente visto antes no se detectaba, y el insert chocaba con el índice único `jobs_user_url` (el aviso fallaba en `errors` de la ingesta). Ahora la URL canónica y el id externo se buscan en jobs de cualquier fecha; empresa+título y texto siguen limitados a la ventana. Revisado en producción el 2026-09-18: **ningún caso real**. Las 3 alertas de LinkedIn procesadas y todas las corridas del cron de GoB desde el deploy dieron `errors: []`; además, el job más viejo es del 2026-09-07, así que nada había salido todavía de la ventana. El primer momento en que podía fallar era el **2026-09-21 15:00 UTC**; este fix tiene que estar deployado antes.
- **Deploy:** llegó 2 h 46 min después de la fecha límite (2026-09-21 15:00 UTC). En esa ventana entró 1 alerta de LinkedIn sin errores y no corrió el cron: cero fallas reales.

### JS-025 · UI de `posible_duplicado` con fusión manual
`deps:` JS-008 (ADR-013), JS-016 · `est:` 2 h · `estado:` todo (para más adelante)
- Desde ADR-013, empresa + título parecido no fusiona: inserta con `jobs.duplicate_of_id` y flag `posible_duplicado`. Hoy eso no se ve en ningún lado.
- Mostrar el flag en la lista y en el detalle, con link a la oferta parecida y un botón "fusionar" que haga lo mismo que el merge automático (fuentes a `job_sources`, fecha más antigua), más "no son la misma", que limpia la marca.
- **Acepta:** fusionar a mano no pierde ningún JD (depende de JS-024); descartar la marca la saca de la lista de posibles duplicados.

## Bloque 4b — Mejoras del uso real (reporte de Mauro, 2026-09-21)

Ordenado por impacto. Un ticket por rama, tests antes del código.

### JS-026 · Ir a la oferta original y confirmar la postulación (P0.1) ✅ done 2026-09-21
`deps:` JS-015, JS-016 · `est:` 2 h · `estado:` done
- En `/jobs`, cada card tiene "Ver oferta ↗" (pestaña nueva) hacia `canonical_url` o, si no hay, la URL de alguna fuente. En el detalle, "Postular ↗" destacado.
- Al volver a la pestaña de la app después de abrir la oferta, un diálogo pregunta "¿Te postulaste a esta oferta?". "Sí" dispara el evento `apply` existente (transition() + fila en `applications`); "No" no hace nada.
- **Alcance:** es una **confirmación manual en el momento justo**, no detección de postulación. La app no ve el sitio externo; lo único automático es *cuándo* se pregunta.
- **Acepta:** e2e `07-ver-oferta-postular.spec.ts` (link en lista y detalle, "Sí" deja `aplicada` en la base, "No" no cambia nada, aviso sin link no muestra botones).
- **Comportamiento esperado, no es bug (verificado 2026-09-21):** las ofertas del golden no tienen URL (el dataset no la trae), así que no muestran "Ver oferta" ni "Postular". En la base local de Mauro las 17 ofertas de LinkedIn sin botón eran todas del golden; las de ingesta real tenían botón y abrían bien. Tampoco es bug que una oferta vencida del lado de LinkedIn abra su página con "No longer accepting applications": el link es correcto y la oferta ya cerró.
- **LinkedIn puede fallar de forma transitoria (verificado 2026-09-21):** "No se ha podido cargar la página. Es probable que el ID indicado no sea válido o se haya eliminado" apareció al abrir ofertas con IDs válidos, que después abrieron bien con sesión real. Ese mensaje **no siempre significa que la oferta caducó** ni que el link esté mal armado. Antes de tocar código: reprobar más tarde y comparar el ID con el `href` del email original (en `raw_blobs`).

### JS-027 · Pegar JD evalúa al instante (P0.2) ✅ done 2026-09-21
`deps:` JS-017, JS-013, JS-026 · `est:` 2 h · `estado:` done
- Guardar el JD dispara la evaluación en el momento, sin esperar al cron de 6 h.
- Mientras evalúa, la oferta aparece en `/jobs` como "evaluando" (no desaparece).
- Cuando termina, la vista se actualiza sola (poll corto o revalidación).
- **Implementado (2026-09-21):** al guardar el JD (UI, MCP `paste_jd`, y también las cargas manuales con JD completo por `/jobs/new` y `add_job`) se llama a `evaluateJobNow` en `after()`. Reclama **el mensaje de esa oferta** con `FOR UPDATE SKIP LOCKED` (si el cron ya lo tiene, no evalúa dos veces), respeta `LLM_DAILY_CAP_USD` antes de tocar la cola y cierra el mensaje igual que el worker: ok → done; falla → reintento con backoff para el cron. En `/jobs` lo que tiene evaluación en cola o en curso sale **arriba**, marcado "Evaluando…", **aunque haya filtro de score** (antes quedaba al final por no tener score, o fuera del filtro, y parecía ausente). La lista y el detalle se refrescan cada 3 s mientras haya algo evaluándose, durante 3 min como máximo. Tests: 4 de integración (`evaluateJobNow`: reclamo, no doble evaluación con el cron, tope de gasto, falla del modelo) y e2e 02 (evaluada sin correr el worker) y 08 (evaluando visible con filtro y actualización sin recargar). En e2e la app corre con `LLM_DEMO=1`.

### JS-028 · Corregir un estado mal marcado (P1.1) ✅ done 2026-09-21
`deps:` JS-016 · `est:` 2 h · `estado:` done
- Desde el detalle, cambiar el estado a mano después de haberlo marcado, con confirmación ("¿seguro que querés cambiar el estado de X a Y?"). Respeta la máquina de estados con una corrección explícita, sin escribir `jobs.status` directo.
- **Implementado (2026-09-21):** la corrección no es un evento más, sino una operación aparte con reglas puras en `packages/pipeline/src/status-correction.ts`. Solo se corrige **desde** estados que marca la persona (aplicada, entrevista, oferta, rechazada, rechazo automático, descartada, cerrada) y **hacia** estados posteriores a la evaluación, siempre que la oferta tenga evaluación. Una cerrada desde la cola de JD, sin evaluación, solo vuelve a `pendiente_jd`. La postulación acompaña al estado corregido: a aplicada, entrevista, oferta o rechazos se asegura la fila con su resultado; a evaluada o descartada se **borra la registrada por error**, para no ensuciar la calibración (JS-036); a cerrada se marca `cerrada_antes` si existía. UI: "Corregir estado" en el detalle, con selector y `confirm()`. Se loguea `from`/`to`. Tests: 6 unitarios y el e2e `09-corregir-estado.spec.ts`.

### JS-029 · Filtro de score libre (P1.2) ✅ done 2026-09-21
`deps:` JS-015 · `est:` 1 h · `estado:` done
- El score mínimo pasa de una lista fija a un selector de 0 a 9, de a un punto.
- **Implementado (2026-09-21):** `<select>` con "cualquiera" y de ≥ 0 a ≥ 9. Es un select y no un slider: cada cambio reescribe la URL y recarga la lista, y en el celular un slider dispararía una navegación por cada paso. `parseJobFilters` acepta solo enteros de 0 a 9; cualquier otro valor en la URL (12, -1, 6.5, abc) se ignora y queda sin filtro. Test: e2e `10-filtro-score.spec.ts`.

### JS-038 · Acciones y volumen en `/inbox` (P1.3) ✅ done 2026-09-21
`deps:` JS-020 · `est:` 3 h · `estado:` done (PR #12; migración 0012 aplicada en Neon 2026-09-21 23:50 UTC, antes del deploy)
- Por fila: "no me sirve esta fuente" (descartar), marcar como visto y eliminar. Descartados y vistos salen de la vista por defecto pero quedan en la base; solo "eliminar" borra.
- **Volumen:** contador visible (recibidos en 24 h, cuántos sin parser) y aviso cuando se dispara respecto del promedio. Además, registrar los rechazos por el límite de 100/hora, que hoy descartan el email sin guardarlo ni avisar.
- **Implementado (2026-09-21):**
  - **Migración 0012:** `inbound_emails.seen_at` y `dismissed_at`, y la tabla `inbound_rejections` (usuario y hora, RLS forzado). Es solo aditiva: **correr `pnpm db:migrate` contra Neon antes de deployar**, porque el código nuevo lee esas columnas.
  - **Vistas en `/inbox`:** Pendientes (por defecto: ni vistos ni descartados), Vistos, Descartados y Todos, con conteos. Acciones por fila: "Marcar visto", "No me sirve", "Volver a pendientes" y "Eliminar" (con `confirm()`).
  - **Eliminar:** borra la fila, y el crudo **solo si ningún aviso lo usa como fuente** (`job_sources.raw_ref`, JS-024). Si lo usa, el crudo queda.
  - **Volumen:** arriba se ve "N en 24 h · M sin parser · promedio X/día". `assessInboxVolume` (pipeline, puro) avisa en tres casos:
    - hubo rechazos por el límite (esos emails se perdieron);
    - un pico de 30 o más en 24 h que supera 3 veces el promedio de los 7 días anteriores;
    - 20 o más sin parser que son al menos el 80 % del total: el caso de un filtro de Gmail que reenvía todo el correo.
  - **Rechazos:** el webhook cuenta los que corta el límite en `inbound_rejections`, una fila por usuario y hora.
  - **Tests:** 6 unitarios; la integración del webhook cuenta 2 rechazos en la misma hora; un chequeo nuevo exige RLS forzado en **toda** tabla con `user_id`; e2e `11-inbox.spec.ts`.
- **Fuera de alcance:** "No me sirve" actúa sobre ese email, no silencia al remitente para los próximos. Si hace falta, sería un ticket aparte.
- **Hueco que mostró el uso real (2026-09-21):** el filtro de Gmail tenía la condición mal escrita (`from:(from:(` duplicado) y reenviaba correo que no es de empleo: banco, streaming, GitHub, cursos. Llegaron 27 de 55 emails así y **el aviso no saltó**, porque el volumen era bajo (unos 13 por día, lejos del mínimo de 20 sin parser). Contar volumen no alcanza: la señal es el remitente, no la cantidad. Sigue en JS-048.

### JS-039 · Vista de email unificada con acciones arriba (P2)
`deps:` JS-038 · `est:` 2 h · `estado:` done (2026-09-21)
- Al abrir un email desde `/inbox`, mostrarlo como en un cliente de correo (texto y HTML combinados de forma legible, sin pestañas separadas) con la barra de acciones de JS-038 arriba. El HTML sigue en un `iframe` con `sandbox` vacío.
- **Implementado (2026-09-21):**
  - **Encabezado:** asunto, remitente, fecha y estado, con las **mismas acciones que la lista** (`EmailActions`, compartido). Eliminar desde el detalle vuelve a `/inbox`.
  - **Un solo cuerpo:** el HTML si existe, si no el texto. El texto plano y los links quedan plegados ("Ver como texto plano", "Links del email"), como el "ver original" de un cliente de correo.
  - **Legibilidad en el celular:** al HTML se le antepone CSS dentro del mismo iframe (viewport, imágenes y tablas al ancho).
  - **Seguridad:** el iframe sigue con `sandbox` vacío, así que los links del HTML no se abren desde adentro; por eso están listados aparte.
  - **Abrirlo lo marca visto** (pedido de Mauro en la revisión), salvo que esté descartado. "No me sirve" sigue disponible en un email visto, y "Volver a pendientes" desde el detalle vuelve a `/inbox` (quedarse lo remarcaría visto).
  - **Tests:** e2e `12-email-detalle.spec.ts`.

### JS-049 · Selección múltiple en `/inbox` ✅ done 2026-09-22
`deps:` JS-038 · `est:` 1.5 h · `estado:` done (pedido de Mauro, 2026-09-22; va antes de JS-048)
- **Por qué:** el filtro de Gmail mal escrito dejó pasar 27 emails que no son de empleo (banco, GitHub, streaming). Borrarlos de a uno, con un diálogo por email, era demasiada fricción, y va a volver a pasar cada vez que el filtro se escape, hasta que esté JS-048.
- **Implementado:**
  - Casilla por fila y "Seleccionar todos", que marca **solo las filas de la pestaña actual** (Pendientes, Vistos, Descartados o Todos). Si la pestaña tiene más de las 50 que se muestran, lo dice.
  - Barra de acciones (`role="toolbar"`) que aparece solo con algo seleccionado: "Marcar visto", "No me sirve", "Eliminar" y "Cancelar selección".
  - **Eliminar en lote:** una sola confirmación con la cantidad ("¿Eliminar 25 emails?"), todo en una transacción y con la misma regla que de a uno: el crudo que un aviso usa como fuente se conserva.
  - Las funciones de `lib/inbox-list.ts` aceptan uno o varios ids (con tope de 200 y solo uuids válidos; RLS limita al usuario). "Marcar visto" y "No me sirve" conservan la fecha de la primera vez.
- **"No me sirve", aclarado:** solo guarda `dismissed_at`. No borra el email ni su crudo, no toca avisos y no silencia al remitente para los próximos. "Volver a pendientes" lo revierte.
- **Tests:** e2e `13-inbox-seleccion.spec.ts`: visto y "no me sirve" en lote, eliminar en lote con una sola confirmación (cancelar no borra; el crudo con aviso se conserva) y "seleccionar todos" por pestaña.

### JS-047 · Parser de alertas de Indeed (propuesto)
`deps:` JS-022 · `est:` 1.5 h · `estado:` todo (propuesto, sin priorizar)
- Es la fuente sin parser que más emails de empleo trae: 4 en producción al 2026-09-21 (`match.indeed.com`), hoy en la cola manual. `canonicalUrl` ya reduce las URLs de Indeed al parámetro `jk`. Mismo contrato que LinkedIn y Get on Board: fixtures anonimizadas y fallar cerrado.

### JS-048 · Alerta de "posible fuga del filtro" por dominio nuevo en `/inbox`
`deps:` JS-038, JS-022 · `est:` 2 h · `estado:` todo (pedido de Mauro, 2026-09-22)
- **Por qué:** ver el hueco anotado en JS-038. Un filtro de reenvío mal configurado se nota primero por **quién** manda, no por cuánto llega: con el primer email del banco ya había motivo para avisar.
- **Qué:** si en las últimas 48 h llegó un email de un dominio **que nunca se vio antes** y que **no es una fuente de empleo esperada**, `/inbox` muestra un aviso propio, "Posible fuga del filtro de reenvío", separado del de volumen alto. Salta con un solo email.
  - El aviso lista cada dominio nuevo con su cantidad y la fecha del primero, más un link a esos emails.
  - **Fuentes esperadas:** los dominios con parser (LinkedIn, Get on Board) más los que la persona marque a mano como fuente de empleo (acción nueva "Es fuente de empleo" en el aviso). Los que marque como "No es de empleo" dejan de avisar, pero siguen contando como no esperados.
  - **Categoría orientativa:** una lista corta y explícita de dominios de bancos, streaming y e-commerce le pone la etiqueta ("banco", "streaming"…) para que se note la gravedad. Lo que no está en la lista dice "dominio nuevo": no se lee el contenido para clasificar.
  - **Borrado en lote:** el aviso ofrece "Eliminar todos los de este dominio", con confirmación. Es la acción que hizo falta el 2026-09-22 con los emails del banco.
- **Dónde:** función pura en `packages/pipeline` (recibe los dominios de 48 h, los vistos antes y las fuentes esperadas, y devuelve los dominios sospechosos) con tests primero, igual que `assessInboxVolume`.
- **Acepta:** con los datos reales del 2026-09-19 al 21, el aviso habría saltado con el primer email de Santander, y con los de Netflix, Duolingo, etc., cada uno el día que llegó. Un dominio con parser o marcado como fuente de empleo no avisa nunca. Un dominio ya visto antes de las 48 h no vuelve a avisar.

### JS-046 · Aviso "esta oferta puede estar cerrada" (futuro, baja prioridad)
`deps:` JS-026, JS-028 · `est:` 2 h · `estado:` todo (para más adelante)
- Surge del diagnóstico de links del 2026-09-21: de las ofertas de LinkedIn en producción, 4 estaban cerradas del lado de LinkedIn y la persona recién se enteraba al abrirlas.
- Mostrar en la card y en el detalle un chip "Puede estar cerrada" **antes** del click, solo con señales permitidas:
  - **ADR-004 prohíbe código que navegue LinkedIn**, así que no se consulta la página ni el endpoint público de LinkedIn para saber si cerró. Mis consultas del diagnóstico fueron manuales y puntuales, no algo a automatizar.
  - **Get on Board:** es su API oficial. Si un aviso deja de aparecer en el listado de su categoría, se marca como posiblemente cerrado.
  - **LinkedIn:** solo señales indirectas. Una es la antigüedad (por ejemplo, más de 30 días desde que se vio sin que la persona lo haya abierto); otra, que el JD pegado contenga "No longer accepting applications".
  - **Reporte de la persona:** un botón "Este link no funciona / ya cerró" que la cierra con el evento `close`, reversible con JS-028.
- **Acepta:** el chip aparece con cada señal; nunca se cierra sola una oferta solo por antigüedad (es aviso, no decisión); ninguna llamada a dominios de LinkedIn en el código.

## Bloque 5 — Inteligencia (semanas 3–6)

### Adelanto de JS-030/JS-031 sin LLM ✅ 2026-09-11
- `packages/pipeline/src/skills/match.ts`: mapeo determinista del campo `stack` a la taxonomía (término entero de slug/nombre/alias, más largos primero, tapa el tramo; `deseable`/`nice` → no must). Cobertura sobre el golden: 229/267 menciones (86 %); lo no mapeado son herramientas fuera de la taxonomía (Jira, ServiceNow, PowerShell) y texto libre ("estadística en muestras chicas"). Aliases nuevos en `seeds/skills.json` (agentes, tool-use, .net, eventbridge, seguridad, growth, tarjetas…).
- `market.ts`: `computeDemand` (Σ score × must ? 1 : 0,4; sin score pesa 5) y `buildAgenda` (gaps = ≥ 2 menciones y nivel ≤ 1; diferenciales = nivel 3; en crecimiento = nivel 2).
- Seed: `job_skills` desde el stack del golden (se recalcula en cada seed) y `skill_levels` autodeclarados desde `profile_summary` (`seeds/skill_levels.mauro.json`, provisorios hasta la entrevista dirigida).
- `pnpm market:snapshot [--local] [--week] [--since-days]` escribe `market_snapshots` (usuario, semana). `/market`: Server Component con gaps, diferenciales, en crecimiento y tabla completa; filtro por rango de semanas (formulario GET). Queda para JS-030/031: skills desde la JD real (hecho después con `extractSkillsFromText`). Snapshot semanal automático: hecho el 2026-09-11 (`/api/cron/market` + schedule de los lunes en `cron.yml`, recalcula snapshot y plan por usuario).

### Modo offline del evaluador (pre-score determinista) ✅ 2026-09-11
- `pipeline/skills/prescore.ts`: pre-score 0–10 sin LLM = 3 + 6 × cobertura (skills de la JD con nivel ≥ 2 sobre las que tienen nivel) − riesgos del prefiltro (ubicación −1, candidatos/dominio −0,5) − 1 si el salario máximo está bajo el piso, acotado por el cap de título; sin skills mapeadas asume 5. Siempre marcado como "pre".
- `extractSkillsFromText` (mismo matcher por alias) rellena `job_skills` desde la JD en la ingesta (GoB, manual, JD pegada) y con `pnpm skills:extract [--local] [--all]` para lo ya cargado. Esto también alimenta `market_snapshots` con ofertas reales, no solo el golden.
- UI: caja punteada "pre" en la lista y sección "Pre-evaluación determinista · sin LLM" en el detalle (riesgos, tenés / te faltan / sin nivel, cobertura, ajustes). MCP `list_jobs` devuelve `pre_score_sin_llm`.

### JS-030 · Extracción y normalización de skills por oferta
### JS-031 · Snapshot semanal de mercado y página /market
### JS-032 · Perfil verificable: ingesta CV/LinkedIn PDF/portfolio/GitHub
### JS-033 · Entrevista dirigida por skill y niveles 0–3
### JS-034 · Gap analysis y plan de formación ✅ done 2026-09-11 (versión determinista)
- `pipeline/skills/plan.ts`: prioridad = demanda_ponderada × (1 − nivel/3) × facilidad, con facilidad = 16 h / closure_hours acotada a [0,1; 1] (sin dato 0,5). `pnpm plan:build [--local]` sincroniza `learning_plan_items` desde el último snapshot: nuevas → pendiente con el mejor recurso aprobado (target_level > nivel, menos horas); existentes conservan estado y recurso; pendientes que ya no aplican se quitan.
- Catálogo manual en `seeds/learning_resources.json` (schema documentado en `_schema`; 9 entradas de ejemplo: AWS Skill Builder, DataCamp, Anthropic Academy, docs). El LLM proponiendo recursos queda para después (`proposed_by_llm`, `approved=false`).
- `/plan`: Server Component agrupado por estado, Server Actions pendiente → en curso → cerrada (fechas), horas estimadas y recurso con link. Probado en Docker.
### JS-035 · Servidor MCP propio ✅ done 2026-09-11
- `apps/web/app/api/mcp/route.ts` con `mcp-handler` (MCP SDK v2, Streamable HTTP, stateless). Herramientas: `list_pending_jd`, `list_jobs` (score mínimo, estado, cantidad), `get_job`, `set_status` (eventos manuales vía `transition`), `paste_jd`, `market_summary`. Reutiliza las funciones de la UI (`withUser` + RLS). Auth por token compartido `MCP_TOKEN` (Bearer o `?token=`), sin OAuth; usuario `MCP_USER_ID` o el único de `users`. Cómo conectarlo desde Claude: `docs/DEPLOY.md`.
### JS-036 · Feedback loop: outcomes → reporte de calibración (score vs respuesta real) ✅ done 2026-09-11
- `pipeline/feedback.ts` (puro, tests primero): por banda de score (9+, 7–8,9, 5–6,9, <5) cuenta evaluadas, postuladas, entrevista/oferta, rechazo humano, rechazo automático y sin respuesta; métrica del PRD (tasa de respuesta positiva con score ≥ 7); sorpresas (score < 5 con respuesta positiva, rechazo automático por ubicación con `location_ok = ok`, score ≥ 7 sin respuesta); MAE y sesgo modelo vs score humano cargado en la UI (excluye evaluaciones humanas del golden).
- `/applications`: lista de postulaciones con resultado editable (select + nota, Server Action) y el reporte arriba. Los eventos del detalle (rechazar, rechazo automático, entrevista, oferta, cerrar) dejan el resultado en la postulación. E2E flujo 4.
- Queda fuera: recalibrar automáticamente (umbrales o prompt) desde el reporte; primero hay que acumular postulaciones reales. Tool MCP `set_outcome` cuando haga falta.
### JS-037 · Migración de Qué Pinta Salta y Tuki a gemini-3.5-flash usando el harness

## Bloque 6 — Plataforma (después)

### JS-040 · SST y migración 3a (workers a Lambda)
### JS-041 · Onboarding de terceros, BYOK, planes
### JS-042 · Recruiter CRM y follow-ups
### JS-043 · Interview prep por oferta
### JS-044 · Application Kit RAG

## Reglas del backlog

- Techo semanal después del finde: 8 hs. Si el bloque 4 no está en producción en 2 semanas, se congela el bloque 5.
- Ningún ticket nuevo entra sin criterio de aceptación.
- Los tickets del bloque 5 se detallan cuando el bloque 4 esté done.
