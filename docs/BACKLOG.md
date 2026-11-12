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
- **Producción:** dominio `ingest.malejo.com.ar` verificado en Resend con envío **y recepción**; registros en la zona de Vercel (DKIM, SPF, MX de feedback en `send.ingest`, y **MX de recepción** `ingest MX 10 inbound-smtp.sa-east-1.amazonaws.com`, que tiene que ser el de menor prioridad del subdominio). Webhook `https://busquedalaboral.malejo.com.ar/api/inbound` con `RESEND_WEBHOOK_SECRET` e `INGEST_DOMAIN` cargados. `profiles.inbound_address` cargada por **UPDATE puntual** (hoy cada usuario la ve y la rota en Ajustes): el seed completo NO se corre contra producción, reescribiría perfil y golden.
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

### JS-025 · UI de `posible_duplicado` con fusión manual ✅ done 2026-09-22
`deps:` JS-008 (ADR-013), JS-016 · `est:` 2 h · `estado:` done
- Desde ADR-013, empresa + título parecido no fusiona: inserta con `jobs.duplicate_of_id` y flag `posible_duplicado`. Hoy eso no se ve en ningún lado.
- Mostrar el flag en la lista y en el detalle, con link a la oferta parecida y un botón "fusionar" que haga lo mismo que el merge automático (fuentes a `job_sources`, fecha más antigua), más "no son la misma", que limpia la marca.
- **Acepta:** fusionar a mano no pierde ningún JD (depende de JS-024); descartar la marca la saca de la lista de posibles duplicados.
- **Implementado (2026-09-22):**
  - **Regla (pipeline, `planDuplicateMerge`):** queda la oferta con historia propia (evaluación o postulación). Si ninguna tiene, queda el original (al que apunta la marca). **Si las dos tienen, no se fusiona** (decisión de Mauro): se perdería una evaluación completa; quedan "No son la misma" o descartar una a mano. Además exige el flag: el puntero solo no alcanza, porque el golden usa `duplicate_of_id` para `volume_recruiting`.
  - **Fusión (adapters, `mergePossibleDuplicate`, en una transacción con RLS):** las fuentes del absorbido pasan al que queda **con su crudo** (JS-024), así que ningún JD se pierde. Aplica las mismas reglas que la fusión automática: fecha más antigua, JD más largo (con hash, shingles y skills) y flags acumulados sin `posible_duplicado`. Hereda la URL si no tenía, repunta otras marcas y borra la evaluación pendiente del absorbido. Si el absorbido se está evaluando, se rechaza la fusión. Si el que queda esperaba JD y la recibe, se evalúa enseguida (como en JS-027).
  - **"No son la misma":** saca el flag y el puntero.
  - **UI:** en `/jobs`, aviso "N posibles duplicados para revisar" con filtro `?duplicados=1` (cualquier estado) y etiqueta "posible duplicado" en la card. En el detalle del marcado, la sección "Posible duplicado" con link a la parecida, "Fusionar" (con confirmación) y "No son la misma"; si no se puede fusionar, explica por qué y no ofrece el botón. En la original, la lista de sus posibles duplicados.
  - **Tests:** 10 unitarios de la regla, 6 de integración (caso real, ningún JD perdido, evaluación al recibir JD, las dos con historia, sin marca, "no son la misma") y e2e `14-posible-duplicado.spec.ts` (3 flujos).
  - **Producción al 2026-09-22:** hay 1 caso marcado y las dos ofertas ya están evaluadas, así que la pantalla ofrece solo "No son la misma".

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

### JS-050 · Ruido social de LinkedIn: "no relevante" por remitente ✅ done 2026-09-22
`deps:` JS-021, JS-038 · `est:` 1 h · `estado:` done (regla acordada con Mauro, 2026-09-22; va antes de JS-025)
- **Por qué:** de los 22 emails de LinkedIn en producción, 12 eran ruido social (artículos, cursos, "es popular en tu red", invitaciones, "apareciste en 20 búsquedas"). Llegan del mismo dominio que las alertas, así que JS-048 no los cubre, y caían en la cola manual como "estructura no reconocida".
- **Regla (determinista, por la dirección exacta del remitente):**
  - `jobalerts-noreply@` y `jobs-noreply@` → parser de LinkedIn, como hasta ahora.
  - `messages-noreply@`, `invitations@` y `notifications-noreply@` → se **guardan** con su crudo, con `parser = 'linkedin_social'` y ya descartados. En `/inbox` se ven en Descartados como "no relevante: notificación social de LinkedIn" y se recuperan con "Volver a pendientes".
  - Cualquier otro remitente de `linkedin.com` → el camino de siempre: parser y, si falla, cola manual.
- **Por qué por remitente y no por asunto:** las alertas siempre tienen el asunto `«Búsqueda»: Empresa - Puesto publicado el M/D/AA` (7 de 7), pero `jobs-noreply@` también trae avisos con asuntos variados ("Nuevos empleos similares a…", "X busca personal para…"). Filtrar por asunto habría perdido 3 emails con 7 avisos reales. El remitente separa los 22 casos sin excepción.
- **Red de seguridad (pedido de Mauro):** si LinkedIn cambia una notificación social y empieza a traer tarjetas de aviso, el email **no** se descarta ni se ingesta: queda en Pendientes con el error "notificación social de LinkedIn con N tarjetas de aviso: revisar la regla de remitentes". Así el cambio se ve.
- `linkedin_social` no cuenta como "sin parser" en el aviso de volumen (JS-038) y no cuenta como fuga del filtro en JS-048: el remitente es conocido.
- **Tests:** unitarios de `linkedinSenderKind` (los 5 remitentes, mayúsculas, remitente desconocido y dominios que imitan a LinkedIn); 2 de integración del webhook (se guarda descartado con su crudo; con tarjetas queda pendiente y no se ingesta); e2e de la etiqueta en `/inbox`.
- **Fuera de alcance:** los 12 emails sociales que ya estaban en la base no se reprocesan (ya estaban descartados a mano).

### JS-051 · Privacidad: de remitentes no esperados se guarda solo remitente, asunto y fecha ✅ done 2026-09-22
`deps:` JS-020, JS-048 · `est:` 1.5 h · `estado:` done (pedido de Mauro, 2026-09-22; prioridad sobre seguir buscando la causa del reenvío de GitHub)
- **Por qué:** si el reenvío de Gmail vuelve a mandar correo personal (pasó el 2026-09-18..21 con banco y streaming, y el 22/9 con notificaciones de GitHub), su contenido quedaba guardado entero en `raw_blobs`: códigos, resets de contraseña, resúmenes bancarios. La protección tiene que valer aunque el filtro falle.
- **Regla (`isExpectedSender`, pipeline):** se guarda completo solo lo que viene de una fuente esperada (`EXPECTED_SOURCE_DOMAINS`: LinkedIn, incluidos sus remitentes sociales; Get on Board; Indeed) o de un dominio que la persona marcó como fuente de empleo (JS-048), con cualquier subdominio. "No es de empleo" no habilita nada.
- **El webhook, para cualquier otro remitente,** guarda en `raw_blobs` solo `email_id` (para la idempotencia), remitente, destinatarios, asunto y fecha, con `content: null` y el motivo en `redacted`. Ni cuerpo ni nombres de adjuntos. La fila de `inbound_emails` queda con el error "remitente no esperado…" y no pasa por ningún parser.
- **UI:** el detalle de un email sin cuerpo explica por qué y ofrece "Marcar <dominio> como fuente de empleo"; desde ahí, los próximos de ese dominio se guardan completos. El aviso de fuga (JS-048) y el volumen siguen funcionando igual, porque usan remitente y fecha.
- Indeed pasa a ser fuente esperada: ya no avisa como fuga.
- **Tests:** unitarios de `senderHost` e `isExpectedSender` (incluido un dominio que imita a LinkedIn); 3 de integración del webhook (remitente no esperado sin cuerpo ni adjuntos y con idempotencia; dominio marcado como empleo se guarda completo; "no es de empleo" sigue sin cuerpo); e2e del detalle.
- **Fuera de alcance:**
  - Los emails de remitentes no esperados que ya estaban guardados completos no se tocan: borrarles el cuerpo es una escritura en producción aparte.
  - El route handler igual pide el cuerpo a la API de Resend; se descarta en memoria y no se guarda.
  - Resend conserva los emails recibidos 30 días en su panel.

### JS-047 · Parser de alertas de Indeed ✅ done 2026-09-22
`deps:` JS-022 · `est:` 1.5 h · `estado:` done
- Es la fuente sin parser que más emails de empleo trae: 4 en producción al 2026-09-21 (`match.indeed.com`), hoy en la cola manual. `canonicalUrl` ya reduce las URLs de Indeed al parámetro `jk`. Mismo contrato que LinkedIn y Get on Board: fixtures anonimizadas y fallar cerrado.
- **Implementado (2026-09-22), `inbound/indeed.ts`:** el email de "empleo compatible" de `donotreply@match.indeed.com`. Un aviso por email, con el asunto "<Título> en <Empresa>" (5 de 5 emails reales).
  - **Qué extrae:** título (`<h2><a class="strong-text-link">`), empresa y ubicación (los dos `<p>` siguientes), y los bloques opcionales "Tipo de empleo" y "Sueldo". "Desde casa" = remoto; cualquier otra ubicación, modalidad `desconocida`.
  - **Id del aviso:** los links van envueltos en `cts.indeed.com/v3/<gzip en base64>`; el `jk` se saca **decodificando el token localmente, sin navegar**. La URL queda `https://ar.indeed.com/viewjob?jk=<jk>`, que `canonicalUrl` reduce al `jk`, así cruza con una carga manual del mismo aviso.
  - **No inventa:** el sueldo viene sin moneda ("$1.045,00 - $3.232,58 por mes"), así que va como nota y no como USD. La vista previa de la descripción está recortada: `jdText` null → pendiente de JD. `countriesAllowed` null.
  - **Falla cerrado:** sin HTML, sin título, con más de un aviso, sin `jk`, o si el asunto no es "<título> en <empresa>" (acepta prefijo de reenvío).
  - **Fuente:** `kind = email_generic`, nombre "Indeed (email)". El enum de Postgres no tiene `email_indeed`, y agregarlo sería una migración en producción solo por una etiqueta.
  - **Bug atrapado antes de producción:** en los emails reales "Sueldo" y "Tipo de empleo" comparten sección, sin separador entre ellos. El primer corte del bloque se llevaba el contrato dentro del sueldo. La fixture se rehízo con la estructura real (verificada contra el email del 2026-09-18) y el bloque termina en el próximo `<h3>`.
  - **Tests:** 18 unitarios sobre 4 fixtures anonimizadas (textos ficticios, tokens de tracking sintéticos), con 98 % de líneas; 1 de integración (webhook → aviso enlazado al crudo). Validado contra el email real de `fixtures-private/`.

### JS-048 · Alerta de "posible fuga del filtro" por dominio nuevo en `/inbox` ✅ done 2026-09-22
`deps:` JS-038, JS-022 · `est:` 2 h · `estado:` done (pedido de Mauro, 2026-09-22; migración 0013 ya aplicada en Neon el 2026-09-22 ~05:03 UTC)
- **Por qué:** ver el hueco anotado en JS-038. Un filtro de reenvío mal configurado se nota primero por **quién** manda, no por cuánto llega: con el primer email del banco ya había motivo para avisar.
- **Qué:** si en las últimas 48 h llegó un email de un dominio **que nunca se vio antes** y que **no es una fuente de empleo esperada**, `/inbox` muestra un aviso propio, "Posible fuga del filtro de reenvío", separado del de volumen alto. Salta con un solo email.
  - El aviso lista cada dominio nuevo con su cantidad y la fecha del primero, más un link a esos emails.
  - **Fuentes esperadas:** los dominios con parser (LinkedIn, Get on Board), incluidos los remitentes conocidos de LinkedIn, también los sociales de JS-050, que no son una fuga, más los que la persona marque a mano como fuente de empleo (acción nueva "Es fuente de empleo" en el aviso). Los que marque como "No es de empleo" dejan de avisar, pero siguen contando como no esperados.
  - **Categoría orientativa:** una lista corta y explícita de dominios de bancos, streaming y e-commerce le pone la etiqueta ("banco", "streaming"…) para que se note la gravedad. Lo que no está en la lista dice "dominio nuevo": no se lee el contenido para clasificar.
  - **Borrado en lote:** el aviso ofrece "Eliminar todos los de este dominio", con confirmación. Es la acción que hizo falta el 2026-09-22 con los emails del banco.
- **Dónde:** función pura en `packages/pipeline` (recibe los dominios de 48 h, los vistos antes y las fuentes esperadas, y devuelve los dominios sospechosos) con tests primero, igual que `assessInboxVolume`.
- **Acepta:** con los datos reales del 2026-09-19 al 21, el aviso habría saltado con el primer email de Santander, y con los de Netflix, Duolingo, etc., cada uno el día que llegó. Un dominio con parser o marcado como fuente de empleo no avisa nunca. Un dominio ya visto antes de las 48 h no vuelve a avisar.
- **Implementado (2026-09-22):**
  - **Regla pura** `detectFilterLeaks` (pipeline): agrupa remitentes por dominio base (`mails.` y `comunicaciones.` de un banco son un solo dominio, con los segundos niveles de país como `com.ar`), y avisa si el primer email del dominio es de las últimas 48 h, no es fuente esperada (`EXPECTED_SOURCE_DOMAINS`: LinkedIn, incluidos sus remitentes sociales, y Get on Board) y la persona no lo marcó. Categoría orientativa por el **comienzo** del nombre del dominio contra una lista explícita (así "stackoverflow" no cae en streaming); lo que no está dice "dominio nuevo".
  - **Tabla `inbound_sender_domains`** (migración 0013, RLS forzado): la decisión de la persona por dominio, `empleo` o `no_empleo`.
  - **UI en `/inbox`:** aviso rojo propio, "Posible fuga del filtro de reenvío", separado del de volumen (los dos con `aria-label`). Por dominio: etiqueta, cantidad y fecha, "Ver" (filtra la lista por ese dominio, `?dominio=`), "Es fuente de empleo", "No es de empleo" y "Eliminar todos", con una sola confirmación con la cantidad. Se borra en tandas con la misma regla que de a uno: el crudo con aviso queda.
  - **Tests:** 20 unitarios (dominio base, categorías, la regla y el escenario del 2026-09-18) más un chequeo en adapters de que todo dominio con parser es fuente esperada; e2e `15-fuga-filtro.spec.ts` (3 flujos).
  - **Validado contra producción el 2026-09-22 (solo lectura):** al deployar, el aviso muestra `github.com` (3 emails desde el 22/9 04:46 UTC, **después** de corregir el filtro) y `devups.io` (1). No muestra Indeed, Teamtailor ni Google, que se vieron por primera vez hace más de 48 h.

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
`estado:` parcial (ronda 10, PR #45, 2026-10-07)
- Candidatos a skill nueva deterministas (`skillCandidates`: terminos tecnicos frecuentes en los JD que no estan en la taxonomia, sin stopwords, IDs ni nombres de las empresas de las ofertas) y contrato de la tarea `extract_skills` (`normalizeExtracted`: lo conocido contra lo propuesto; falla cerrado y nunca toca la taxonomia). Falta el backfill con LLM (JS-100).

### JS-031 · Snapshot semanal de mercado y página /market
`estado:` done en lo movil (ronda 10, PR #45, 2026-10-07)
- `/market` usable en el celular: tarjetas en gaps, diferenciales y en crecimiento; fila compacta en la tabla completa; formulario y `summary` de 44 px; seccion de candidatos a skill nueva. Pendiente: cache de candidatos (JS-102) y accesibilidad (JS-101).
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

### JS-054 · Orden de prioridad en la lista: score y despues riesgos ✅ done 2026-10-27
`deps:` JS-052 · `est:` 1 h · `estado:` done (nube N2, PR #252, mergeado 2026-10-27): `listJobs` desempata por cantidad de riesgos a igual score; lo heredan siguiente/anterior, «Lo nuevo» de `/hoy` y `list_jobs` del MCP. e2e `86-orden-por-riesgos`. `first-offers.ts` y `first-steps.ts` siguen sin mirar riesgos. Seguimiento nube N4 (PR #271, mergeado 2026-10-30): regla única `compareJobPriority` en pipeline (score; a igual score, menos bloqueadores y después menos riesgos) en `first-offers`, `first-steps` y `listJobs`
- Con las penalizaciones de `decide()` corregidas (JS-052), los riesgos pasan a ser el unico canal de viabilidad: dos ofertas con el mismo score ya no se diferencian por el score.
- Ordenar la lista por score descendente y, dentro de cada score, por cantidad de riesgos ascendente (menos riesgos primero).
- **Acepta:** dos ofertas con score 7, una con 1 riesgo y otra con 3, salen en ese orden; el orden es estable y se testea sin LLM.

### JS-066 · Limpieza de privacidad del arbol publico (sin reescribir historia) ✅ done 2026-10-06
`deps:` — · `est:` M · `estado:` done (ronda 01): el barrido del arbol da 0 hallazgos
- **Por que:** el barrido del arbol versionado (HEAD) marca datos que no deberian estar en un repo publico: IDs de avisos con formato real en fixtures, una fixture capturada de la API de una fuente, montos y un nivel de ingles en tests, y una plataforma real en un ejemplo de perfil.
- **Que:**
  - IDs de avisos de las fixtures de parsers con prefijo ficticio `0000`: LinkedIn numerico; Indeed `jk` hexadecimal de 16;
  - la fixture de la fuente reescrita con datos inventados, con la misma estructura;
  - montos y piso salarial de los tests ficticios, con los montos relativos al piso;
  - dominios reservados (`.example`, `.test`) en emails y URLs de ejemplo;
  - docs sin resultados de postulaciones reales.
- **Acepta:** el barrido del arbol (`--tree`) da 0 hallazgos y los tests prueban lo mismo que antes.

### JS-075 · Golden publico sin datos de postulaciones reales ✅ done 2026-10-06
`deps:` — · `est:` M · `estado:` done (ronda 01)
- **Que:**
  - afuera: estados de postulacion y montos;
  - fechas: ficticias;
  - titulos: genericos, conservando las palabras de las que depende el prefiltro;
  - salarios sinteticos solo si un eval los necesita;
  - `meta`: neutro.
- **Acepta:** la decision del prefiltro es la misma para cada id antes y despues; `golden.test.ts` en verde.

### JS-065 · Seed con datos de ejemplo aunque exista `fixtures-private/` ✅ done 2026-10-07
`deps:` — · `est:` 1 h · `estado:` done (ronda 03, PR #38): `SEED_FIXTURES=example`; un valor invalido corta antes de escribir
- **Por que:** `loadFixture` (`packages/db/src/fixtures.ts:25`) usa la version privada de cada fixture si el archivo existe, sin forma de evitarlo. Por eso `db:seed --local` carga los datos privados en la base de desarrollo de Docker, que tiene que tener datos ficticios: la usan los tests, los e2e y la revision de UI.
- **Que:**
  - una variable de entorno (por ejemplo `SEED_FIXTURES=example`) o un flag `--example` que haga que `loadFixture` ignore `fixtures-private/` y use siempre `PUBLIC_PATHS`;
  - el seed avisa en el log que fuente uso, como ya hace (`seed.ts:58`).
- **Tests:** con el switch puesto, `loadFixture` devuelve `source: "example"` aunque exista el archivo privado (se simula con un directorio temporal). Sin el switch, el comportamiento no cambia.
- **Fuera de alcance:** el seed contra la nube (sigue igual, con confirmacion).

### JS-063 · Guarda local: ningun nombre real en commits, pushes ni PRs ✅ done 2026-10-06
`deps:` — · `est:` 3 h · `estado:` done (ronda 01): matcher y modos versionados en `scripts/privacy-scan.mjs` con `--tree` y tests con patrones ficticios. Fuera: el hook `pre-push` versionado (`core.hooksPath`) y un `pr:check` en `package.json`; hoy los cubren el hook local y el script de PR · **prioridad: antes que JS-055** (decision 2026-09-28)
- **Por que:** la regla del repo publico se rompio dos veces (2026-09-18 y 2026-09-24/26) y las dos por descuido al redactar, no por falta de regla. Hace falta una red que lo ataje sola. Un barrido a mano ademas fallo por distinguir mayusculas: se escapo un identificador en minuscula con un nombre real en un test.
- **Regla, antes que la herramienta:** commits, PRs, docs y tests se redactan con alias desde el principio ("Empresa X (golden id N)"). El hook es la red, no el metodo.
- **Alcance:**
  - **Hook `pre-push`** versionado (por ejemplo `.githooks/pre-push`, activado con `git config core.hooksPath .githooks`). Lee los nombres reales de `fixtures-private/empresas.map.json` (las claves) y, si existe, una lista privada extra `fixtures-private/deny-list.txt` para datos del perfil (anios, nivel de ingles, empleador). Revisa las lineas agregadas de `git diff <remoto>..<local>`, los mensajes de `git log <remoto>..<local>` y el nombre de la rama. Coincidencia **sin distinguir mayusculas** y por palabra completa. Si encuentra algo, falla mostrando archivo y linea con el nombre enmascarado.
  - **Sin `fixtures-private/`** (un clon del repo publico): avisa y deja pasar, no bloquea a terceros.
  - **Chequeo de PRs:** un script (por ejemplo `pnpm pr:check --title "…" --body-file …`, o un `pnpm pr:create` que lo envuelva) que corre el mismo matcher sobre titulo y descripcion antes de `gh pr create`, y tambien antes de `gh pr edit`.
  - Un solo matcher compartido por el hook y el script, con tests.
- **Evals y golden (contexto para no confundir resultados):** los evals de CI corren contra el golden **publico**, que tiene las JD de los golden 35 y 36 recortadas y parafraseadas. Las decisiones de calibracion se miden contra el golden **privado** (JD completa y perfil real), en una corrida local. Un verde de CI no reemplaza esa corrida. Aparte: hoy el job de CI corre `evaluate_job@v1` y no la version vigente (ver JS-058).
- **Fuera de alcance:** reescribir la historia (JS-062) y el pedido a soporte.
- **Acepta:** un push con un nombre real en un comentario, en un mensaje de commit o en un identificador en minuscula falla; sin `fixtures-private/` avisa y pasa; `pr:check` bloquea un titulo o una descripcion con un nombre real; los tests del matcher cubren mayusculas, palabra completa y enmascarado.

### JS-055 · Subir risks_recall y blockers_precision
`deps:` JS-052 · `est:` a estimar · `estado:` en curso. Parte de codigo done 2026-10-07 (ronda 04, PR #39): una regla de region ajena en el prefiltro que solo suma `location_risk`, sin mejora medible en el golden; la perdida de ubicacion es del modelo o de descartes previos del prefiltro. Sigue la parte de prompt (corrida paga)
- Medido el 2026-09-24 sobre las 36 del golden con `evaluate_job@v1.3.2`: `risks_recall` 64 % y `blockers_precision` 63 %, los dos contra un umbral de 100 %.
- Sube de prioridad por JS-052: si el score deja de penalizar inglés y años, la viabilidad viaja entera por los riesgos. Un riesgo que el modelo no emite ahora no lo compensa nadie.
- `blockers_precision` baja sobre todo por bloqueadores que el modelo inventa fuera de la lista cerrada (tipo `otro`) y por bloqueadores de disciplina sobre roles que si estan en el carril.
- **Primero `location_risk_recall` (38 %)**: el modelo devuelve `ok` donde la referencia dice `riesgo`. Es la de mayor costo: un riesgo de ubicacion que no se emite termina en postulaciones que no prosperan.
- **Acepta:** a definir cuando entre, con una corrida completa antes y despues.
- **Traspaso (2026-09-28), para el que lo tome:**
  - **Arranca por `location_risk_recall` (38 %).** Es la metrica con mas costo (ver arriba). Ver `evals/README.md` para correr el subset antes y despues de cada cambio.
  - **Empresa AD (golden id 36) perdio con `evaluate_job@v1.3.2` el riesgo de solapamiento horario** (al menos 4 horas diarias de solapamiento con US Eastern) que v1.3.1 si reportaba. Esta en la JD y en `human_risks` del golden. Entra en el alcance de este ticket. Ojo al medirlo: `classifyRisk` (`evals/src/metrics.ts`) no tiene un tipo para horario y lo cuenta como `otro`; conviene sumar un tipo `horario` para que `risks_recall` lo muestre por separado.
  - **Va despues de JS-063** (decision 2026-09-28): primero la guarda de nombres, despues este ticket.
  - **La proxima version del prompt sale de aca** y tambien reescribe el ejemplo de `v1.3.2` que cita frases textuales del aviso del golden 35 (ver JS-062). Una sola corrida de evals para los dos cambios. El texto del aviso no se cita en ningun lado: ni en el prompt nuevo, ni en docs, ni en commits.
  - **Datos para calibracion (JS-036):** hay casos fuera del golden que cambiaron de accion al re-evaluarlos con el perfil corregido. El detalle es privado y no va en el repo.

### JS-062 · Reescribir la historia publica para sacar datos privados ✅ done 2026-09-28
`deps:` JS-055 (limpieza de archivos, PR #31) · `est:` 1 h + espera de soporte · `estado:` done (queda la purga de refs, que depende de soporte)
- **Por que:** entre el 2026-09-24 y el 26 entraron a `main` nombres reales de empresas, resultados de postulacion y datos del perfil real (anios, nivel de ingles, skills), contra la regla del repo publico. El PR #31 los saco de los archivos; seguian en la historia y en las refs de los PRs.
- **Que se hizo (2026-09-28):**
  - `main` se reescribio una sola vez con `git filter-repo` (`--replace-text` y `--replace-message`) en un clon limpio y aislado. La lista de reemplazos, los patrones de verificacion y el detalle de los commits afectados viven en `fixtures-private/`, no en el repo.
  - Cambiaron de SHA los ultimos 20 commits de `main`; los anteriores quedaron igual. No hay tags.
  - Verificado antes del push: barrido sin distinguir mayusculas en cero sobre los mensajes y el contenido de toda la historia nueva, y `pnpm lint && pnpm typecheck && pnpm test` en verde. Push con `--force-with-lease`; el deploy de `main` quedo en `success`.
  - **Orden real:** se reescribio antes de mergear el PR #32 (la nota "no antes del #32" quedo vieja). El #32 se rebaseo despues sobre el `main` nuevo, con los mismos parches (verificado con `git range-diff`, 2026-10-05).
- **JD de los golden 35 y 36 (decision 2026-10-05):** la reescritura solo les cambio el nombre de la empresa y algunas frases. El texto se parafraseo despues con un commit normal en el golden publico. No se reescribe la historia otra vez por esto.
- **Prompt en produccion (decision 2026-09-28):** `packages/prompts/evaluate_job.v1.3.2.md` cita como ejemplo frases del aviso del golden 35. **`v1.3.2` no se toca**: la reescritura las excluyo a proposito, porque cambiarlas modificaba el prompt en produccion sin evals. Se reescriben en la proxima version del prompt (la que salga de JS-055), con **una sola corrida de evals que cubra los dos cambios**: el ejemplo reescrito y las mejoras de riesgos.
- **Pendiente (lo hace Mauro):** mandar el pedido a soporte de GitHub para purgar las refs de los PRs anteriores a la reescritura (texto y lista en `fixtures-private/`) y borrar desde la web las revisiones viejas de las descripciones de PR que se editaron.
- **Impacto:** base de datos y produccion, ninguno; el deploy cambio solo comentarios, docs y el golden.
- **Acepta:** barrido en cero sobre la historia nueva ✅; CI y deploy de `main` en verde ✅; soporte confirma la purga de las refs (pendiente).

### JS-061 · Flujo de revision: ocultar lo ya decidido, ir de a una y ver el avance ✅ done 2026-09-26
`deps:` JS-015, JS-029 · `est:` 5 h · `estado:` done
- **Uso real (Mauro, 2026-09-26):** entra, ve las ofertas del dia o de la semana y quiere recorrerlas de mayor a menor score, salteando las que ya tienen una accion tomada, hasta terminar todas las verdes de ese periodo. Hoy tiene que rastrear a mano cuales ya recorrio.
- **Lo que ya existe (no reimplementar):** `/jobs` ordena por score desc y despues `first_seen` desc; el filtro Estado ofrece `activas` / `todas` / un estado puntual, y `estado=evaluada` ya da exactamente "sin accion tomada"; hay un filtro `Desde` (date picker sobre `first_seen`) y un score minimo (JS-029). **El problema es el default:** `activas` (`ACTIVE_STATUSES` en `apps/web/lib/labels.ts`) incluye `aplicada`, `entrevista` y `oferta`, que son justo las ya recorridas. `descartada`, `cerrada` y `rechazada` ya quedan ocultas.
- **Alcance:**
  - **Default nuevo de `/jobs`: `estado=evaluada`**, orden score desc. "Todas" sigue en el mismo select (es el toggle "mostrar todas"; no hace falta otro control). `nueva`, `prefiltrada` y `pendiente_jd` salen del default: no tienen score, y `pendiente_jd` ya tiene su flujo en `/jobs/pending-jd`.
  - **Atajos de fecha `hoy` / `esta semana` / `todas`** al lado del `Desde` actual, calculados en la zona del perfil (`America/Argentina/Salta`). Ojo con un detalle que ya existe: hoy el filtro arma `${desde}T00:00:00Z`, o sea medianoche **UTC**, que en Argentina son las 21 del dia anterior. Los atajos tienen que usar la zona del perfil, y conviene corregir el `Desde` de paso. "Esta semana" = desde el lunes.
  - **Indicador de avance:** "X de Y ofertas verdes de esta semana revisadas". Y = ofertas con la ultima evaluacion en `aplicar` o `aplicar_personalizado` y `first_seen` dentro del rango elegido, **en cualquier estado**; X = las de ese conjunto que ya no estan en `evaluada`. "Revisada" significa que tiene una accion tomada (postular, descartar, cerrar): mirarla y dejarla en `evaluada` no cuenta, que es justamente lo que la mantiene en la cola.
  - **"Siguiente"** en el detalle de una oferta: lleva a la proxima `evaluada` con el **mismo orden y los mismos filtros** que la lista (van en la URL del detalle). Despues de postular o descartar, la actual deja de ser `evaluada` y el siguiente sale solo. Atajo de teclado (`n`, o `j`/`k` para siguiente/anterior) que no se dispare adentro de un input ni del textarea de la JD. Es el unico pedazo que necesita `"use client"`.
  - **Un solo lugar para el orden.** La lista y "siguiente" usan la misma funcion de orden, con `id` como desempate estable; si no, "siguiente" saltea o repite ofertas con el mismo score. Y **JS-054** (dentro del mismo score, menos riesgos primero) va a cambiar ese orden: que cambie en un solo lugar.
- **Fuera de alcance:** el default de la tool MCP `list_jobs` (sigue en `activas`); guardar la preferencia de filtros entre sesiones.
- **Acepta:** entrar a `/jobs` sin parametros muestra solo `evaluada` por score desc; con `hoy`, solo lo que entro hoy en hora de Salta; postular la primera y apretar "siguiente" lleva a la segunda del orden; el indicador cuenta bien una verde ya aplicada y una verde todavia en `evaluada`; el atajo no se dispara escribiendo en un input. Los e2e que asumen que `/jobs` muestra ofertas `aplicada` por default se actualizan en el mismo PR.
- **Implementado (2026-09-26):**
  - **Regla pura** `packages/pipeline/src/review.ts` (25 tests): `startOfDayInZone` y `periodStart` con la zona como parametro (sin offset fijo: respeta horario de verano), semana desde el lunes, `resolveSince` (atajo + `Desde`, gana el mas reciente), `reviewProgress` con `ACTED_STATUSES` explicitos y `neighbors`.
  - **Lista:** default "sin revisar" = `evaluada` **o lo que se esta evaluando** (sin eso el e2e de JS-027 se rompia: una oferta recien pegada no se veia). `activas` y `todas` quedan en el mismo select. Elegir un periodo limpia el `Desde` y viceversa.
  - **Orden en un solo lugar:** `jobNeighbors` corre la misma `listJobs` con `include: <id actual>`, asi la oferta que se acaba de descartar sigue ubicada en su lugar del orden. Desempate estable por `id`.
  - **Detalle:** `ReviewNav` (el unico `"use client"`) con anterior/siguiente y atajos `j`/`n`/`k`; los filtros viajan en la URL del detalle.
  - **MCP:** `list_jobs` pasa `activas` explicito para no cambiar su contrato.
  - **Limite conocido:** si hay mas de 100 ofertas sin revisar y la actual cae despues de la 100 (`LIST_LIMIT`), "siguiente" queda deshabilitado en vez de adivinar.
  - **E2E** flujo 16 (3 tests): default y "todas", avance medido en deltas, periodo que limpia el `Desde`, y "siguiente" despues de descartar.

### JS-057 · Re-evaluar no mueve el estado ✅ done 2026-09-26
`deps:` JS-052 · `est:` 2 h · `estado:` done
- Surge del 2026-09-24: `pnpm worker:requeue --job <id>` sobre una oferta en `aplicada` no hace nada. `requeue-cli` filtra `status === "evaluada"` y la manda a `skipped`; si igual llegara, `evaluateJobById` corta en `canTransition(job.status, "evaluated")` antes de la llamada al LLM. **No cambia `status`, `applications` ni `applied_at` — porque no ejecuta nada.** El worker no menciona `applications` en ninguna linea: solo inserta en `evaluations` y actualiza `jobs.status`.
- El problema real es que **esas evaluaciones quedan con el prompt y el perfil viejos**, y alimentan `market_summary`. Al 2026-09-24 hay ofertas en `aplicada` evaluadas con v1.3.1 y el perfil anterior.
- **Alcance:**
  - `status.ts`: `evaluated` no mueve el estado en `aplicada`, `entrevista` y `oferta` (la transicion devuelve el mismo estado). Re-evaluar es leer de nuevo, no retroceder en el embudo.
  - `requeue-cli`: los ids pasados explicitamente con `--job` se aceptan en esos estados; el camino masivo por `--model` **sigue restringido a `evaluada`**, para no re-evaluar el embudo entero sin querer.
  - Tests: re-evaluar una `aplicada` la deja en `aplicada`, escribe una `evaluations` nueva y **no toca `applications.applied_at` ni `applications.outcome`**.
- **Acepta:** `--job a8b70138…` (Empresa AD, golden id 36) re-evalua y la oferta sigue en `aplicada` con su fecha de postulacion intacta; `--model gemini-3.5-flash` sigue omitiendo lo que no esta en `evaluada`.
- **Implementado (2026-09-26):**
  - **Maquina de estados** (`pipeline/status.ts`): `evaluated` es un bucle sobre si mismo en `aplicada`, `entrevista` y `oferta`. No agrega botones: la UI filtra por `MANUAL_EVENTS` y `evaluated` lo dispara solo el worker. Lo terminal (`descartada`, `rechazada`, `rechazo_automatico`, `cerrada`, `descartada_prefiltro`) sigue sin poder re-evaluarse.
  - **`REQUEUE_STATUSES` / `requeueAllowed(status, mode)`**: `bulk` (`--model`) = solo `evaluada`; `explicit` (`--job`) = `evaluada`, `aplicada`, `entrevista`, `oferta`. Un test cruza las dos reglas: todo lo re-encolable, el worker lo evalua sin cambiarle el estado.
  - **`requeue-cli`**: elige el modo segun el flag y el mensaje de omitido dice por que (masivo vs terminal).
  - **Tests:** 13 unitarios en `status.test.ts`; integracion (Testcontainers): en `aplicada`, `entrevista` y `oferta` la re-evaluacion escribe una `evaluations` nueva, deja el estado igual y **no toca `applied_at`, `channel`, `outcome`, `outcome_at` ni `outcome_note`**; una `descartada` se saltea sin llamar al modelo.
  - **Pendiente operativo:** re-encolar Empresa AD y las otras 3 que quedaron con v1.3.1, **despues del deploy**: el cron corre con el codigo deployado y, con el viejo, las saltearia.

### JS-059 · Separar el presupuesto de evals del de produccion
`deps:` JS-052 · `est:` 3 h · `estado:` todo
- **Pasó el 2026-09-24:** las dos validaciones completas de JS-052 (256 llamadas, USD 2,25) consumieron `LLM_DAILY_CAP_USD` y, horas después, el worker se frenó con las 49 ofertas reales encoladas: `FRENADO por tope de gasto: USD 2,2600 en 24 h ≥ LLM_DAILY_CAP_USD=2`. El tope hizo lo que tenia que hacer, pero **calibrar el evaluador bloqueó evaluar ofertas**, que son dos cosas distintas con urgencias distintas.
- Hoy `spendLast24h` suma **todas** las `llm_calls` de las ultimas 24 h contra un unico tope, y lo consultan tanto el worker como el harness de evals. Las corridas de evals ya se marcan aparte (`task = eval:<version>`, JS-011), asi que el dato para separarlos ya esta en la tabla.
- **Propuesta:**
  - `spendLast24h` recibe un ambito: `produccion` (excluye `task LIKE 'eval:%'`) o `evals` (solo `eval:%`).
  - Dos topes: `LLM_DAILY_CAP_USD` para el worker y los caminos de producto, y `LLM_EVALS_DAILY_CAP_USD` para el harness. Una calibracion cara ya no puede dejar sin evaluar las ofertas del dia.
  - **Un tope global de seguridad** `LLM_TOTAL_DAILY_CAP_USD` que cuenta todo y frena cualquiera de los dos caminos. Sin esto, partir el presupuesto en dos solo duplica el techo, que es lo contrario de lo que se busco despues del 2026-09-10.
  - El mensaje de freno dice **cual** de los tres topes salto y cuanto falta para que la ventana movil libere.
- **Acepta:** con una corrida completa de evals recien terminada, `pnpm worker:evaluate` procesa la cola igual; con el tope global agotado, los dos caminos frenan y el log nombra el tope global. Tests sobre `spendLast24h` con filas `eval:*` y de produccion mezcladas.

### JS-058 · Que la promocion de un prompt no pueda quedar a medias
`deps:` JS-052 · `est:` 3 h · `estado:` todo
- Surge del 2026-09-24: el PR #23 mergeo `evaluate_job.v1.3.2.md`, las reglas de `decide()` y los criterios v2, pero `DEFAULT_PROMPT_VERSIONS.evaluate_job` quedo en `v1.3.1`. Produccion deployo bien y siguio evaluando con el prompt viejo. Se descubrio de casualidad, mirando el codigo antes de correr el requeue; si no, se re-evaluaban ~40 ofertas con el prompt equivocado.
- Una promocion tiene **tres patas** y ninguna avisa si falta otra: (1) el archivo `.md`, (2) el puntero en `client.ts`, (3) los criterios activos en `evaluation_criteria.rules` con los campos que las reglas nuevas necesitan.
- **Propuesta, las dos cosas:**
  - **Test en CI (el guardarrail).** Marcar en el frontmatter del prompt `estado: vigente | candidato | retirado`. Un test verifica que hay **exactamente un `vigente` por tarea** y que `DEFAULT_PROMPT_VERSIONS` apunta a ese. Asi un prompt candidato puede vivir en el repo sin promoverse (que es justo lo que hizo v1.3.2 durante dos dias), y olvidarse de mover el puntero rompe el build. No se deriva de "la version mas alta": eso promoveria cualquier experimento por el solo hecho de existir.
  - **`pnpm prompt:promote <task@vN>` (la parte operativa).** Cambia el frontmatter y el puntero, y **verifica contra la base** que los criterios activos tengan las claves que el prompt y `decide()` necesitan (hoy: `allowed_disciplines`, `discipline_cap_score`, `english_risk_from`, `years_gap`). Si faltan, falla y dice cual. Solo lectura contra la base; no escribe criterios.
- **Acepta:** con el puntero en una version y el frontmatter en otra, `pnpm test` falla nombrando las dos; `prompt:promote` falla si los criterios activos no tienen las claves nuevas.

### JS-064 · `evals recompute` con las anclas actuales del golden, separadas por origen ✅ done 2026-10-07
`deps:` JS-052 · `est:` 2 h · `estado:` done (ronda 02)
- Surge del 2026-09-28 (JS-053): al alinear los criterios privados con los activos, `recompute` informó una mejora de `action_acc` que mezclaba anclas. `recomputeReport` recalcula la acción del modelo con el golden y los criterios actuales, pero `human_action`, `human_score_match` y `anchor_source` quedan como estaban en el reporte guardado. Una oferta re-puntuada después de la corrida se comparó contra su acción humana vieja, y el número no distinguía anclas `human` de `assisted`.
- **Propuesta:**
  - `recompute` vuelve a leer del golden actual `human_score`, `human_score_match`, `accion`, `human_blockers`, `human_risks`, `human_location_ok` y `anchor_source`, y lista cada ancla que cambió respecto del reporte ("ancla actualizada: id N, acción X → Y").
  - La salida separa las métricas por origen del ancla (`human` y `assisted`), como ya hace `compare` con `splitByAnchorSource`. Las `human` son la evidencia no circular; las `assisted` quedan como control.
  - `--anclas-del-reporte` reproduce el cálculo viejo, para comparar con números ya publicados.
- **Acepta:** test con un reporte cuya acción humana difiere de la del golden actual: `recompute` usa la del golden y lo avisa. La salida muestra `action_acc`, `false_apply` y `false_discard` por separado para `human` y `assisted`.

### JS-067 · Metricas del harness: ubicacion despues de decide(), riesgos por tipo y hash de criterios ✅ done 2026-10-07
`deps:` — · `est:` M · `estado:` done (ronda 02). `false_discard` pasa a contar solo errores del modelo; la definicion anterior sigue como `false_discard_total`
- **Por que:** `location_risk_recall` mide la salida cruda del modelo, no lo que ve el usuario: `decide()` y el prefiltro agregan el riesgo de ubicacion y eso no se mide. El solapamiento horario cae en `otro`. Un reporte no dice con que criterios se calculo.
- **Que:**
  - `location_risk_recall_final` (lee `decision.prefilter.flags` antes que el texto de riesgos), junto a la cruda;
  - tipo de riesgo `horario`;
  - `risks_recall` por tipo;
  - falso descarte del prefiltro separado del del modelo;
  - hash de `criteriaRules` en `meta`, con aviso en `recompute` si no coincide;
  - tabla de tokens de `run.ts` actualizada (estimacion, no eleccion de modelo).
- **Acepta:** `recompute` sobre un reporte guardado muestra las dos cifras de ubicacion, el recall por tipo y el aviso de hash; tests en verde.

### JS-074 · Prompt `evaluate_job` sin el literal de un aviso real ✅ done 2026-10-07
`deps:` — · `est:` S + corrida · `estado:` done. v1.3.3 (2026-10-07, 1 corrida) empeoraba metricas estrictas y no se promovio. **v1.3.4 promovida el 2026-10-07** con 3 corridas contra 3 de v1.3.2 del mismo dia (criterio: `blockers_recall` sin bajar, `blockers_precision` hasta -5 pp, `discipline_acc` hasta -3 pp, `score_mae` hasta +0,15, sobre la media): recall igual, precision -2,8 pp, disciplina +2,8 pp, MAE +0,11. Produccion deja de tener el literal del aviso real
- **Por que:** el ejemplo de mision contra requisitos de v1.3.2 cita frases de un aviso real; una busqueda las identifica. Es el prompt de produccion.
- **Que se hizo:** v1.3.3 reescribio el ejemplo de cero en otro dominio y perdio el ancla de produccion creativa; v1.3.4 la recupero con un ejemplo inventado del mismo tipo. Se promovio v1.3.4.
- **Criterio aplicado:** 3 corridas de la candidata contra 3 de la vigente, el mismo dia y con el mismo codigo, sobre la media (tolerancias en el estado). Plan original: 1 corrida de v1.3.3; se reemplazo porque con una sola corrida de la vigente la comparacion salia al reves.

### JS-077 · Los evals de CI miden el prompt vigente
`deps:` JS-067 (CLI) · `est:` S · `estado:` ✅ done 2026-10-07 (ronda 02): `--prompt vigente` en el CLI y `EVALS_PROMPT: vigente` en `ci.yml` (≈ USD 0,16 por corrida de CI, contra ≈ 0,09 con v1)
- **Por que:** el job `evals` de CI corre `evaluate_job@v1`, no la version de produccion. Un PR que cambia el prompt vigente o el golden se mide contra una version vieja (ver tambien JS-058).
- **Que:** `pnpm evals run --prompt vigente` resuelve a la version que usa produccion; `ci.yml` pasa a `EVALS_PROMPT: vigente`, con el costo por corrida estimado antes de aplicarlo.
- **Acepta:** el log del job muestra la version vigente; el costo por corrida queda anotado en el PR.

### JS-069 · MCP: token solo por Bearer y contenido externo marcado como no confiable ✅ done 2026-10-07
`deps:` JS-035 · `est:` M · `estado:` done (ronda 03, PR #38)
- **Que se hizo:** token solo por `Authorization: Bearer` (`?token=` solo con `MCP_ALLOW_QUERY_TOKEN=1`), comparacion en tiempo constante; las tools que devuelven contenido externo lo envuelven en un bloque de dato no confiable; las de escritura piden confirmacion explicita en el chat; esquemas Zod en adapters y ninguna tool acepta `userId` de la entrada; e2e de autenticacion.

### JS-068 · Endpoints: health opaco, CRON_SECRET en tiempo constante y reset de contrasena con URL fija ✅ done 2026-10-07
`deps:` — · `est:` S · `estado:` done (ronda 03, PR #38)
- **Que se hizo:** `/api/health` devuelve un 503 sin detalle; los tres crons comparan `CRON_SECRET` en tiempo constante; el reset usa `AUTH_URL` (o `NEXT_PUBLIC_APP_URL`) y nunca `Host`, invalida todos los tokens del usuario al consumir uno y manda `Referrer-Policy: no-referrer`.

### JS-079 · Consumir el token de reset de forma atomica ✅ done 2026-10-31
`deps:` JS-068 · `est:` S · `estado:` done (ya resuelto en el código, verificado en la tanda C3, PR #314): `consumeResetToken` (`packages/adapters/src/auth/reset-tokens.ts`) hace `UPDATE … WHERE used_at IS NULL AND expires_at > now RETURNING` dentro de la misma transacción que cambia la contraseña (`resetPassword`); sin fila, vuelve `used`. Lo hizo `71c6617` (S-3). Test de dos consumos concurrentes en `reset-tokens.integration.test.ts`
- **Por que:** `checkResetToken` corre fuera de la transaccion que cambia la contrasena, asi que dos pedidos concurrentes con el mismo token pueden pasar el chequeo (ya existia antes de JS-068).
- **Que:** consumir el token con `UPDATE ... WHERE used_at IS NULL AND expires_at > now() RETURNING` dentro de la misma transaccion; si no devuelve fila, falla.
- **Acepta:** test de integracion con dos consumos concurrentes del mismo token: uno gana, el otro recibe "used".

### JS-078 · El barrido `--pre-push` informa cuando pasa ✅ done 2026-10-27
`deps:` JS-063 · `est:` S · `estado:` done (nube N2, PR #251, mergeado 2026-10-27). Hallazgo previo anotado en el PR: el separador `\x1e` de `scanHistory` deja sin revisar el resto de un archivo que contenga ese byte (falla abierto); va en un ticket aparte. Seguimiento nube N4 (PR #275, mergeado 2026-10-30, carril rojo): el barrido falla cerrado (separador con nonce validado, merges con `--remerge-diff`, opciones de diff fijas, errores y archivos ilegibles marcados, informe sin citar patrones). Requiere git ≥ 2.36
- **Por que:** cuando no encuentra nada, `scripts/privacy-scan.mjs --pre-push` no imprime nada, asi que no se distingue "paso" de "no corrio".
- **Que:** imprimir `pre-push: OK (N commits)` al pasar.
- **Acepta:** test por CLI con un repo temporal que verifica el mensaje y el conteo; con hallazgos, el mensaje de error no cambia.

### JS-080 · El tope `--max-usd` de evals corta siempre ✅ done 2026-10-07
`deps:` — · `est:` S · `estado:` done (ronda 08, PR #44)
- **Por que:** en `evals/src/cli.ts` la condicion para arrancar era `usd <= maxUsd || yes`: con `--yes` el tope no frenaba, y el CI corre con `--yes --max-usd 0.5`. Ademas el tope solo miraba el estimado: durante la corrida no cortaba nada.
- **Que:** si el estimado supera `--max-usd`, aborta siempre (con o sin `--yes`); durante la corrida, antes de cada llamada, si lo gastado mas lo esperado supera el tope, corta y guarda un reporte parcial marcado.
- **Acepta:** tests sin llamadas pagas (generador falso): con `--yes` y estimado sobre el tope, sale con error; una corrida que se pasaria corta antes. El corte es aproximado: las llamadas en vuelo se reservan con el costo esperado, asi que el exceso posible queda acotado a lo que cuesten de mas esas llamadas.

### JS-081 · Metricas por corrida en el reporte de evals
`deps:` — · `est:` S · `estado:` todo (2026-10-07)
- **Por que:** con `--runs 3`, disciplina, bloqueadores y accion salen de una corrida representativa; no hay media ni rango por corrida, asi que no se puede medir la dispersion para decidir una promocion.
- **Que:** `metrics_per_run` en el reporte y `compare` mostrando media y rango.
- **Acepta:** un reporte de 3 corridas trae las metricas de cada una; `compare` muestra media y rango.

### JS-082 · Prefiltro: avisos que no son IT ✅ done 2026-10-07
`deps:` — · `est:` S · `estado:` done (ronda 06, PR #42)
- Bases genericas de RR. HH. ("carga tu CV", "base general", "talent pool") descartan siempre; otros oficios (administrativo, ventas, atencion al cliente...) descartan salvo senal IT en el titulo. "Informatico" solo no es senal IT. En codigo, no en `CriteriaRules`. Golden privado: misma cantidad de descartes que antes.

### JS-083 · Dedup: empresa vacia o generica no marca `posible_duplicado` ✅ done 2026-10-07
`deps:` — · `est:` XS · `estado:` done (ronda 06, PR #42)
- `isGenericCompany` en `dedup.ts`: la regla de empresa + titulo no marca si la empresa esta vacia o es "confidencial", "importante empresa", "desconocida", etc. Diagnostico con casos inventados en `dedup/diagnostico.test.ts`.

### JS-084 · Medir las causas de `posible_duplicado`
`deps:` JS-083 · `est:` S · `estado:` todo (2026-10-07)
- **Que:** con el snapshot, agregados por fuente (email vs API), por empresa generica y por similitud (1,0 vs 0,6-0,99). Grupos de menos de 5 como "<5". Decide cual de JS-085/086/087 va primero.
- **Acepta:** informe con los agregados y la fecha del snapshot.

### JS-085 · Dedup sin JD: desmentir el titulo con otro campo ✅ done 2026-10-19
`deps:` JS-084 · `est:` M · `estado:` done (PR #94, ronda 52b; verificado en el código el 2026-10-27, nube N2): modalidad conocida y distinta o ubicación normalizada distinta desmienten al título; `ingest-job.ts` pasa los dos campos. La URL base no se usa
- En alertas sin JD, comparar tambien ubicacion, modalidad o URL base antes de marcar; o marcar solo con similitud 1,0 y la misma fuente.
- **Acepta:** tests con casos inventados; los pares del golden no cambian.

### JS-086 · `normalizeCompany`: sufijos `labs` y `group` ✅ done 2026-10-27
`deps:` — · `est:` S · `estado:` done (nube N2, PR #246, mergeado 2026-10-27): `labs` y `group` salen de los sufijos. Solo código y tests; la migración de datos de `companies.name_normalized` y `public_jobs.company_normalized` queda como propuesta en el PR (decisión de Mauro)
- "Empresa X Labs" y "Empresa X Group" colapsan y marcan. Quitar el sufijo solo si queda un nombre de 2 o mas tokens, o sacarlos de la lista. Toca `companies.name_normalized`: puede pedir migracion de datos (decision de Mauro).
- **Acepta:** test de normalizacion; el golden publico no cambia de identidad de empresa.
- **Migración de datos aplicada (2026-10-30, PR #270):** `renorm-companies.ts` (solo lectura) armó el SQL y `run-sql-file.ts` lo ensayó con ROLLBACK y lo aplicó en Neon (operado con Antigravity). 227 filas del pool y 13 ofertas de usuarios re-apuntadas a 19 empresas con «labs»/«group» en el nombre normalizado; verificado: las 273 filas del pool con esos nombres conservan «labs»/«group» y ninguna apunta a una empresa con otro `name_normalized`. Quedan 19 empresas viejas sin «labs»/«group» (18 sin referencias); borrarlas es decisión aparte. No se tocaron flags de duplicado, `dedup_of_id` ni `contacts`.

### JS-087 · Dedup: umbral de titulo con 4 tokens y uno distinto ✅ done 2026-10-19
`deps:` JS-084 · `est:` S · `estado:` done (PR #94, ronda 52b; verificado en el código el 2026-10-27, nube N2): el umbral es estricto (`> 0,6`); cubierto en `diagnostico.test.ts` (H3)
- Jaccard 0,6 marca roles distintos con 4 tokens y uno distinto. Subir el umbral a mas de 0,6 o exigir 3 o mas tokens en comun.
- **Acepta:** probado contra el golden y los casos de `diagnostico.test.ts`.

### JS-088 · Adapters de Remote OK, We Work Remotely, Himalayas y Torre ✅ done 2026-10-07
`deps:` — · `est:` M · `estado:` done (ronda 07, PR #43)
- Adapters puros con fixtures inventadas y tests sin red, `kind: "other"` + `externalId` con prefijo, no conectados al cron. Incluye el arreglo de `htmlToText`: una entidad numerica fuera de rango ya no corta la corrida de Get on Board.

### JS-089 · Verificar formatos y conectar las fuentes nuevas
`deps:` JS-088 · `est:` M · `estado:` todo (2026-10-07)
- **Que:** verificar cada formato contra la fuente real (lista en `docs/sources/*.md`), revisar terminos de uso, migracion del enum `source_kind` con las fuentes que pasen, y conectarlas al cron detras de un flag apagado. Torre, solo si los terminos permiten uso automatizado. Himalayas, solo con el periodo del salario verificado.
- **Acepta:** cada fuente conectada con su formato verificado y el flag apagado por defecto.

### JS-099 · Navegacion en el celular ✅ done 2026-10-20
`deps:` — · `est:` S · `estado:` done (ronda 73, PR #114; verificado el 2026-10-27, nube N2): por debajo de `sm` la nav es un menú desplegable; el e2e `47-textos-y-navegacion` a 360 px llega a todas las secciones
- **Por que:** a 375 px la barra de navegacion se corta y "Mercado" y "Plan" quedan fuera de pantalla.
- **Que:** navegacion que entre en 375 px (scroll horizontal con indicador, o menu).
- **Acepta:** e2e o captura a 375 px con todas las secciones alcanzables.

### JS-100 · Backfill de skills con `extract_skills`
`deps:` JS-030 · `est:` S + corrida · `estado:` todo (2026-10-07)
- **Que:** agregar `packages/prompts/extract_skills.v1.md`, correr el backfill sobre los JD con estimado aprobado (≈ USD 0,006 por JD) y revisar las propuestas antes de sumarlas a la taxonomia.
- **Acepta:** propuestas revisadas a mano; la taxonomia solo crece con aprobacion.

### JS-101 · `/market`: accesibilidad ✅ done 2026-10-21
`deps:` — · `est:` S · `estado:` done (PR #86 y C-4, PR #167; verificado el 2026-10-27, nube N2): `scope="col"`, etiquetas `sr-only` de nivel y demanda, ayuda de candidatos y `/market` en la auditoría axe AA de `70-axe-sesion`
- `scope="col"` en los `<th>`; etiquetas `sr-only` para nivel y demanda en la lista compacta; decir en la ayuda que los candidatos salen de las ultimas ofertas y no del rango de semanas.
- **Acepta:** auditoria de accesibilidad sin hallazgos en `/market`.

### JS-091 · Registro por invitacion ✅ done 2026-10-07
`deps:` — · `est:` M · `estado:` done (ronda 11, PR #47)
- Tabla `invitations` (solo el hash del codigo, vence a los 14 dias), creacion solo para `ADMIN_EMAILS`, `/register` con pre-chequeo antes de scrypt y alta atomica por funcion `SECURITY DEFINER` (`register_with_invitation`). Policies `TO CURRENT_USER` para no depender de `BYPASSRLS` del duenio.

### JS-092 · Borrado de cuenta ✅ done 2026-10-07
`deps:` JS-091 · `est:` M · `estado:` done (ronda 11, PR #47)
- `/settings` → "Eliminar mi cuenta": una transaccion borra al usuario de todas las tablas de `packages/db/src/user-tables.ts` (test que falla si aparece una tabla con duenio fuera de la lista). La sesion de un usuario borrado falla cerrada.

### JS-093 · Tope de costo LLM por usuario ✅ done 2026-10-07
`deps:` — · `est:` S · `estado:` done (ronda 11, PR #47)
- `LLM_USER_DAILY_CAP_USD` ademas del global; el worker pospone 1 h a un usuario topeado y sigue con los demas; evaluar al instante y los borradores tambien lo chequean.

### JS-097 · Borradores de politica de privacidad y terminos ✅ done 2026-10-07 (borrador)
`deps:` — · `est:` M · `estado:` done como borrador (ronda 12, PR #48); falta la revision legal
- Politica (ley 25.326) y terminos de la beta en `apps/web/content/legal/`, inventario de datos por proveedor en `docs/legal/datos-por-proveedor.md`, paginas `/privacidad` y `/terminos` con parser de Markdown sin dependencias.

### JS-103 · `users` legible solo por su duenio ✅ done 2026-10-08
`deps:` JS-091 · `est:` S · `estado:` done (rondas 14 y 14c): `rls/0000` cierra `users_read` y `password_reset_tokens_read`; el bootstrap de `/setup` pasa a `has_any_user()` en `rls/0003` (en `0000` queda cerrado hasta que `0003` lo reemplaza). En Neon se aplica despues del deploy de la 14c
- **Por que:** `users_read USING (true)`: con registro por invitacion, el rol de la app puede leer email y hash de todos.
- **Que:** funciones `SECURITY DEFINER` para lo que necesita leer `users` sin sesion (login, existencia, `/setup`, MCP); `users_read` a `id = auth.uid()` en un paso posterior al deploy, para que la migracion sea compatible con el codigo anterior.
- **Acepta:** test de RLS con el rol de la app: un usuario no lee la fila de otro; el login sigue funcionando.

### JS-104 · El prefiltro usa el pais del perfil ✅ done 2026-10-08
`deps:` JS-094 · `est:` S · `estado:` done (ronda 14c): la ingesta lee `location_country` una vez por lote; `XX`, vacio o sin perfil = pais desconocido → riesgo de ubicacion. Sin el parametro, `prefilter` sigue asumiendo AR (evals no cambia)
- Ningun llamador de `prefilter` pasa `userCountry`, asi que siempre usa AR. Pasar `profiles.location_country` en la ingesta; sin pais cargado, marcar riesgo.
- **Acepta:** test con un perfil de otro pais.

### JS-105 · Tope por usuario: cerrar los huecos ✅ done 2026-10-08
`deps:` JS-093 · `est:` S · `estado:` done (ronda 14c): `capGuard` obligatorio; `jobs/new`, `jobs/[id]` y el MCP usan `evaluateInBackgroundOrExplain` y muestran el aviso (tope, onboarding o pendiente), que nunca lanza
- `capGuard` obligatorio en `draftApplicationAnswers`; aviso de tope en `jobs/new`, `jobs/[id]` y el MCP; `spendCapReason` exportado desde `llm/index.ts`.
- **Acepta:** typecheck falla si un llamador no pasa el guard; las tres pantallas muestran el aviso.

### JS-106 · Terminos publicos y aceptacion en el registro ✅ done 2026-10-08
`deps:` JS-091, JS-097 · `est:` S · `estado:` done (rondas 14 y 14c): casilla versionada en la 14; paginas publicas en `/legal/privacidad` y `/legal/terminos`, con `/privacidad` y `/terminos` redirigidas sin sesion
- `/privacidad` y `/terminos` publicas; casilla obligatoria en `/register` validada en el servidor; fecha y version aceptadas guardadas en `users`.
- **Acepta:** registro sin aceptar → error; la aceptacion queda guardada con la version.

### JS-108 · Rate limit de las pantallas de cuenta ✅ done 2026-10-08
`deps:` — · `est:` S · `estado:` done (2026-10-08): regla del firewall de Vercel, ventana fija de 10 por minuto por IP, para el POST de `/login`, `/register`, `/setup`, `/forgot-password` y `/reset-password`. Documentada en `docs/DEPLOY.md`.

### JS-109 · Cierre de `users_read` y paginas legales publicas (14c) ✅ done 2026-10-08
`deps:` JS-103, JS-106 · `est:` S · `estado:` done (ronda 14c)
- Cierre en `rls/0000` (no como archivo aparte, para que ninguna corrida reabra la lectura); `rls-pendiente/0003` retirado del repo (ronda 27). Tests de lectura cruzada con el rol de la app y un duenio sin `BYPASSRLS`. `evaluateInBackground` no evalua sin onboarding completo. El cron de mercado lista usuarios desde `profiles`.

### JS-110 · Respuesta del cron de evaluacion sin errores crudos ✅ done 2026-10-08
`deps:` — · `est:` S · `estado:` done (ronda 14c)
- **Por que:** `cron.yml` imprime la respuesta en el log de Actions, que es publico en un repo publico.
- La respuesta lleva solo conteos y errores por categoria cerrada (`llm`, `validacion`, `otro`); el detalle va a pino con `job_id`. Test de que un error con email, uuid o texto de la base no aparece.

### JS-111 · Prefiltro: colisiones de nombres de pais y paises fuera de la region ✅ done 2026-10-27
`deps:` JS-104 · `est:` S · `estado:` done (nube N2, PR #244, mergeado 2026-10-27): tabla única `REGION_COUNTRIES`, «New Mexico» no es MX, fallback por código eliminado (sí era alcanzable). Queda abierto: países fuera de la región sin «remote» («Madrid, Spain») y perfiles de fuera de la región que nombran su país. Seguimiento nube N4 (PR #273, mergeado 2026-10-30, carril rojo): los dos casos, con país explícito; sin `userCountry` (evals) no cambia y el golden da 0 diferencias
- "New Mexico" cuenta como mencion de Mexico: para un perfil MX una oferta de EE.UU. pasa sin riesgo de ubicacion. `COUNTRY_NAMES` (`normalize/location.ts`) duplica `COUNTRY_OPTIONS` del onboarding y el fallback por codigo es inalcanzable hoy. Paises fuera de la region ("Spain only") no se detectan.
- **Acepta:** test con "New Mexico"; test que compare las dos tablas (o una sola tabla); fallback eliminado.

### JS-112 · Evals: medir el prefiltro con el pais explicito
`deps:` JS-104 · `est:` XS + CI pago · `estado:` todo (2026-10-08, revisor de la 14c)
- `evals/src/golden.ts` llama a `prefilter` sin pais, asi que la regla "solo paises ajenos" que usa produccion no se mide. Pasar `userCountry: "AR"` explicito. Toca `evals/`: dispara el job pago del CI (≈ USD 0,15), va en una ronda con gasto aprobado.

### JS-107 · Retencion y logs sin datos de terceros
`deps:` — · `est:` S · `estado:` ✅ done 2026-10-08 (logs en la ronda 18; purga en la ronda 20, PR #58)
- **Purga (ronda 20):** en el cron de evaluacion; tokens de reseteo vencidos o usados siempre; con `LEGAL_LOG_DAYS`, registros tecnicos (llamadas a IA con minimo de 90 dias, cola terminada, contadores de rechazos con minimo de 2 dias). Los datos del usuario no se purgan por antiguedad.
- **Hecho (ronda 18):** los logs del inbound llevan el dominio del remitente y no su email; los errores de la base se loguean sin consulta ni parametros (`safeDbError`) en la ingesta, el inbound, el worker, `run-sources`, los crons, `health`, la evaluacion inmediata y los borradores; los errores del LLM sin texto del modelo. Queda el texto de error que el MCP devuelve al propio usuario.

### JS-095 · Direccion de email entrante por usuario ✅ done 2026-10-08
`deps:` JS-094 · `est:` S · `estado:` done (ronda 17, PR #55)
- Direccion aleatoria de 20 caracteres asignada al completar el onboarding; visible en Ajustes y en `/inbox` vacio con instrucciones de reenvio; rotacion en dos pasos que invalida la anterior; aviso si la direccion es del formato anterior.

### JS-096 · Criterios editables desde la app ✅ done 2026-10-08
`deps:` JS-094 · `est:` S · `estado:` done (ronda 17, PR #55); falta el e2e
- `/settings/criteria`: listas de titulos y disciplinas, piso salarial, horas, anios maximos, riesgo de ingles y umbrales; version nueva en una transaccion; volver a los valores por defecto. Los cambios valen para ofertas nuevas.

### JS-098 · Auditoria multiusuario (B7) ✅ done 2026-10-08
`deps:` JS-103, JS-095 · `est:` M · `estado:` done (ronda 18)
- Tests de dos usuarios (integracion sobre todas las tablas con duenio y las funciones `SECURITY DEFINER`, que fallan si aparece una nueva sin cubrir; e2e en el CI) y arreglos chicos. Sin bloqueantes en el codigo.

### JS-113 · Endurecer el registro por invitacion ✅ done 2026-10-08
`deps:` JS-095 · `est:` S + RLS · `estado:` done (ronda 23, PR #60; aplicado en Neon)
- Endurecer el registro por invitacion (detalle en las notas privadas de la ronda 18). Toca `rls/0003`; se aplica en Neon.

### JS-114 · Endurecer policies de `evaluations` y `applications` ✅ done 2026-10-08
`deps:` JS-103 · `est:` XS + RLS · `estado:` done (ronda 23, PR #60; aplicado en Neon)
- Endurecer las policies de `evaluations` y `applications` (detalle en las notas privadas de la ronda 18). Toca `rls/0000`; se aplica en Neon.
- **Acepta:** los `it.fails` de la ronda 18 pasan a `it`.

### JS-115 · Idempotencia del webhook por columna ✅ done 2026-10-31
`deps:` — · `est:` S + migracion · `estado:` done (tanda C3, PR #314; ⚠️ migraciones 0052 y 0053 sin aplicar): `inbound_emails.email_id` con índice único (0052) y backfill desde los crudos (0053, la fila más vieja se queda con el valor); el webhook busca por la columna y los dos inserts usan `ON CONFLICT DO NOTHING`, así que tres entregas simultáneas del mismo email dejan una fila (test de integración)
- Columna `email_id` en `inbound_emails` con indice unico, en lugar de buscar en los crudos.

### JS-116 · Vigencia de sesiones ante cambios de credenciales ✅ done 2026-10-31
`deps:` — · `est:` M + migracion · `estado:` done (ya resuelto en el código, verificado en la tanda C3, PR #314): `users.session_version` (migración 0040, `3e6c0e8`, 2026-10-23) + `user_session_version()` (`rls/0011`) + `sv` en el JWT; `resetPassword` sube la versión en la misma transacción y toda lectura de sesión pasa por `currentSession`/`requireUserId` (`lib/session.ts`, única llamada a `auth()`). Tests: `session-version.test.ts`, `multiusuario.integration.test.ts`, e2e `05`. **El reset es hoy el único cambio de credencial que existe**: quien agregue «cambiar contraseña» o «cambiar email» tiene que subir `session_version` en la misma transacción
- Revisar la vigencia de las sesiones despues de cambios de credenciales (detalle en las notas privadas de la ronda 18).

### JS-117 · Inbound: eleccion del destinatario ✅ done 2026-10-08
`deps:` — · `est:` XS · `estado:` done (ronda 18)
- Con varios destinatarios del sistema se elige de forma determinista: primero `received_for` (el destinatario de la entrega), despues `to`, despues `cc`.

### JS-119 · Bandeja automatica ✅ done 2026-10-08
`deps:` JS-095 · `est:` M · `estado:` done (ronda 19)
- Al llegar: con avisos extraidos queda visto; login, verificacion o codigos (de cualquier remitente) se descartan sin guardar contenido y con el asunto enmascarado; la confirmacion de reenvio de Gmail dirigida a la direccion del usuario se guarda completa y aparece arriba de `/inbox` con "Confirmar reenvio" (solo links `https` de los hosts de Gmail); las confirmaciones de postulacion de LinkedIn actualizan el aviso propio si hay un unico candidato, y si no quedan vistas.
- "Pendientes" = solo lo que necesita intervencion (error, sin parser o la confirmacion de Gmail). Acciones en lote por id con "Deshacer" (10 s) y "Volver a vistos/pendientes" en Descartados. Ajustes > Remitentes para cambiar el veredicto de cada dominio.

### JS-120 · Datos legales por variables de entorno ✅ done 2026-10-08
`deps:` JS-097 · `est:` S · `estado:` done (ronda 20, PR #58)
- Los datos del responsable y el plazo de logs se completan en tiempo de ejecucion desde variables; si falta alguna, la pagina dice "en revision". Nunca en el repo.

### JS-121 · Higiene de tests y de escaneo de secretos ✅ done 2026-10-08
`deps:` — · `est:` S · `estado:` done (ronda 20, PR #58; modo nube retirado en la ronda 27, PR #64)
- Los tests de integracion y los e2e fallan antes de conectarse si alguna URL de base del entorno no es local; `.gitguardian.yaml` ignora solo cadenas de prueba inventadas, una por una.
- **Ronda 27:** los tests de RLS corren solo contra la base local o la del CI; se retiraron el script, la rama del test y la config del modo nube.

### JS-122 · Asistente de ingesta en pocos clics (B8) ✅ done 2026-10-08
`deps:` JS-119 · `est:` M · `estado:` done (parte 1: ronda 22a, PR #59; parte 2: ronda 26, PR #63)
- **Parte 1:** archivo de filtros de Gmail por usuario, pantalla del asistente en el onboarding y en Ajustes, y ofertas de las fuentes por API apenas termina el onboarding.
- **Parte 2:** el asistente muestra el paso actual deducido de la base, sin migracion: agregar la direccion, confirmar el reenvio, importar los filtros, esperar la primera alerta y listo. "Ya importe los filtros" queda en una cookie del navegador. El servidor **no** abre links de confirmacion (D-028): el boton los abre en el navegador del usuario. e2e del flujo completo.
- Meta: un invitado configura todo solo en menos de 10 minutos. Ensayo en seco con dos usuarios en el e2e de la ronda 27 (PR #64).

### JS-123 · Registro de llamadas a la IA sin texto del proveedor ✅ done 2026-10-08
`deps:` — · `est:` XS · `estado:` done (ronda 25, PR #62; limpieza aplicada en produccion despues del deploy, control en 0)
- El registro guarda solo metadatos (tarea, modelo, tokens, costo, fecha, usuario) y un codigo de error normalizado (tipo y status HTTP), nunca el texto del proveedor. Las filas viejas con texto pasaron a `legacy_text`. La purga de 90 dias, cubierta por un test en el borde.

### JS-124 · Retirar la version anterior de la funcion de registro ✅ done 2026-10-31
`deps:` JS-113 · `est:` XS + RLS · `estado:` done (tanda C3, PR #314; ⚠️ `pnpm db:migrate` aplica `rls/0001` y `rls/0003`): `DROP FUNCTION IF EXISTS` de `register_with_invitation` (v1) y `register_with_invitation_v2`; el registro usa solo la v3. Los tests de registro pasan a v3 y uno verifica que no existen y que re-aplicar `rls/` no las revive
- Retirar la version anterior de la funcion de registro (detalle en las notas privadas de la ronda 23).

### JS-125 · Ingesta del onboarding sin red en e2e/CI ✅ done 2026-10-27
`deps:` JS-122 · `est:` XS · `estado:` done (nube N2, PR #250, mergeado 2026-10-27): `planFirstIngestNetwork` apaga Get on Board y las fuentes extra con `LLM_DEMO=1`
- La primera ingesta al terminar el onboarding (ronda 22a) sale a la red real de las fuentes por API si el entorno no esta en modo demo; en e2e y CI puede volver flaky un test o crear ofertas despues de la limpieza. Apagarla cuando `LLM_DEMO=1` o con una variable propia del entorno de e2e.
- **Acepta:** con el entorno de e2e, la primera ingesta no hace pedidos de red (test).

### JS-126 · Pulido del onboarding y del registro
`deps:` — · `est:` S · `estado:` parcial (2026-10-31, tanda C3): la parte de **onboarding ya estaba resuelta** (el país se elige con `CountrySearch`, sin «código de 2 letras»; `ProfileForm` muestra el error junto a cada campo y conserva lo cargado, cubierto por el e2e `50-onboarding-no-pierde`). Falta unificar «Repetila» (`setup`, `reset-password`) con «Repetí la contraseña» del registro y los e2e 05 y 06
- "Otro pais: codigo de 2 letras" visible solo al elegir "Otro"; errores junto a cada campo y conservar lo cargado al volver con error; unificar "Repeti la contrasenia" en `setup` y `reset-password` (y los e2e 05 y 06).
- Asistente: si se agrega retencion de la bandeja, derivar "primera alerta recibida" tambien de las fuentes de los avisos, para que no vuelva al paso 1.
- Sumar lo que salga del ensayo de invitacion.
- **Acepta:** e2e de onboarding con un error que conserva lo cargado; los tres formularios con el mismo texto.

### JS-127 · Endurecer la clasificacion del pedido de confirmacion de Gmail
`deps:` JS-122 · `est:` S · `estado:` todo (2026-10-08, ronda 26)
- Hallazgo de severidad baja de la revision de la ronda 26 (detalle en las notas privadas de la ronda). La UI ya pide confirmar solo si la cuenta es propia.

### JS-128 · Guarda de host en la conexion de duenio de los helpers de e2e ✅ done 2026-10-27
`deps:` — · `est:` XS · `estado:` done (nube N2, PR #247, mergeado 2026-10-27): la guarda ya estaba en `ownerDb()`; el spec `85-guarda-helpers` lo prueba. Fuera de alcance: `runDemoWorker` y `computeRoleMarketAndPlan` abren conexión en procesos hijos sin la guarda. Seguimiento nube N4 (PR #272, mergeado 2026-10-30): `localChildEnv()` aplica la guarda al env de los hijos. De la revisión salió un hueco previo en `test-guard.ts` (comas o varios `@` en la URL, esquemas no Postgres): PR #274, mergeado 2026-10-30, carril rojo
- La conexion de duenio de los helpers de e2e usa la misma guarda de base local que los tests de integracion.
- **Acepta:** con una URL remota, los helpers fallan antes de conectarse (test).

### JS-129 · `/api/health` con el commit del deploy en curso ✅ done 2026-10-12
`deps:` — · `est:` XS · `estado:` done (ronda 29, PR #66, mergeado 2026-10-12): `turbo.json` declara `VERCEL_GIT_COMMIT_SHA` en `build`, `/api/health` responde con `Cache-Control: no-store` y un test cubre que la ruta es dinámica. Falta que Mauro confirme después de un deploy que el commit coincide con el de Vercel.
- En produccion `/api/health` muestra un commit anterior al deploy activo: la respuesta queda estatica o en cache. Tiene que ser dinamica (sin prerender ni cache) y mostrar el commit del deploy en curso.
- La ruta ya tiene `force-dynamic` y lee `VERCEL_GIT_COMMIT_SHA` al responder. A verificar: (1) que el build de Vercel no reutilice una salida vieja del cache de Turborepo (la tarea `build` de `turbo.json` no declara variables de entorno); (2) que la variable de sistema llegue en tiempo de ejecucion y no solo al build; (3) los encabezados de cache de la respuesta.
- **Acepta:** test de que la ruta es dinamica y lee el commit en tiempo de ejecucion; despues del deploy, el commit coincide con el de Vercel.

### JS-130 · Skills autodeclaradas y mercado bajo demanda ✅ done 2026-10-09
`deps:` JS-094, JS-034 · `est:` M · `estado:` done (ronda 28, PR #65, mergeado 2026-10-12)
- **Por qué:** para un invitado, `/market`, `/plan` y el prescore lo trataban como nivel 0 en todo (los niveles solo entraban por seed), y las pantallas vacías pedían comandos.
- **Carga:** paso opcional del onboarding y `/settings/skills`. Unas 10 skills sugeridas por rol objetivo (seed `role_skills.json`: Frontend, Backend, Full-stack, QA, Data Analyst, Soporte IT, AI Engineer, UX/UI), buscador sobre la taxonomía y 4 niveles en palabras. El rol no se guarda: se elige en la pantalla y el default sale del titular o de las disciplinas de los criterios, salvo que sean las de fábrica. Server Actions con Zod sobre `skill_levels` (RLS de dueño), sin migración.
- **Mercado y plan bajo demanda:** al terminar el onboarding (después de la primera ingesta) y al guardar skills, snapshot y plan sin LLM. Límite D-029: sin ofertas nuevas ni niveles cambiados, 1 cada 10 minutos; con cambios, un mínimo de 10 s entre recálculos (si cae adentro, espera lo que falta y reintenta una vez). Marca en `job_queue` con lock por usuario. El cron semanal no cambia.
- **Pantallas para personas:** `/market` y `/plan` dicen qué falta (ofertas, skills, cálculo en curso), con link a la acción. Un test impide `pnpm`, `seeds/` o nombres de archivo en el texto de la UI.
- **e2e:** invitado nuevo → carga 5 skills → `/market` deja de marcar todo como gap y el plan ya no lista lo que domina.

### JS-131 · Nombre del producto en una constante y limpieza pre-beta ✅ done 2026-10-12
`deps:` — · `est:` XS · `estado:` done (ronda 29, PR #66). Después, la marca entera pasó a un solo módulo (C-15, PR #178).
- `PRODUCT_NAME` único para el título, los metadatos, los encabezados, los emails y el XML de filtros. Los textos legales quedan para el cambio de nombre.
- Se borran `/privacidad` y `/terminos` dentro de `(app)` (las URLs viejas ya redirigen a `/legal/*` desde `next.config.ts`) y `lib/safe-error.ts` de web, que no tenían uso.

### JS-132 · Feedback de un toque (👍/👎) en el detalle de la oferta ✅ done 2026-10-14
`deps:` — · `est:` S + migración · `estado:` done (PR #86, migración 0026, 2026-10-14). Después: guardar el motivo (#87) y botones accesibles (#93, 2026-10-19).
- **Por qué no entra en `human_score`:** ese número lo usan el snapshot de mercado (peso de la demanda) y el MAE del reporte de feedback. Un 👍/👎 no tiene un número honesto: copiar el score del modelo mete errores 0 en el MAE, y un 👎 no dice si el score estaba alto o bajo.
- **Diseño:** columnas `human_verdict` (enum `de_acuerdo`/`en_desacuerdo`) y `human_verdict_at` en `evaluations`. El motivo corto opcional va en `human_note`. El formulario numérico queda en "Ajustar el score (avanzado)". El reporte de feedback suma la tasa de acuerdo por banda, fuera del MAE.
- **Acepta:** 👎 con motivo persiste; el numérico sigue igual y no pisa el veredicto; B no puede marcar la evaluación de A.

### JS-133 · Taxonomía: skills de diseño, soporte y análisis de datos ✅ done 2026-10-12
`deps:` JS-130 · `est:` S · `estado:` done (ronda 28, PR #67)
- Las sugerencias de UX/UI, Soporte IT y Data Analyst usan lo que hay en la taxonomía de 60 skills. Faltan, por ejemplo, herramientas de diseño, sistemas operativos y redes, y planillas o BI.
- Sumar skills cambia un dato global en Neon (tabla `skills`, hoy cargada desde `skills.json`). Va con plan y lo aplica Mauro. Después se ajusta `role_skills.json`.

### JS-118 · Prefiltro: modalidad no remota en el titulo ✅ done 2026-10-08
`deps:` — · `est:` S · `estado:` done (ronda 21, PR #57). Golden privado: 0 cambios de prefiltro en 3 corridas, metricas sin cambios (Mauro).
- **Por que:** un aviso con la modalidad en el titulo ("Hibrido, CABA") paso el prefiltro: `NON_REMOTE_IN_TEXT` solo mira la ubicacion, y ademas no se aplica si la fuente dijo `modality: "remoto"`.
- **Casos (inventados):**
  - "Desarrollador Backend - Hibrido, CABA", ubicacion "Argentina", modalidad desconocida → descarte `modalidad_no_remota`.
  - "Frontend Engineer (Hybrid, Ciudad X)", modalidad "remoto" segun la fuente → descarte o riesgo (decidir: el titulo contradice a la fuente).
  - "Presencial - Analista de Datos - Empresa A", ubicacion vacia → descarte.
  - "Senior Engineer, remote-first, hybrid optional" → no descartar (definir la regla: "optional"/"opcional" no bloquea).
  - "Ingeniero de Sistemas Hibridos de IA" → no descartar (la palabra no es la modalidad).
- **Acepta:** tests con esos casos en `prefilter.test.ts`; el golden publico no cambia de descartes salvo los esperados (si cambia, medir con el CI pago de evals antes de mergear).

### JS-094 · Onboarding guiado del perfil
`deps:` JS-091 · `est:` M · `estado:` en curso (ronda 14)
- Un invitado sin perfil completo (pais, resumen, criterios) solo accede al onboarding, que crea los criterios por defecto. Sin esto no puede evaluar nada.

### JS-102 · Cachear los candidatos a skill de `/market`
`deps:` JS-031 · `est:` S · `estado:` parcial (rondas 13 y 14): cache por usuario de 1 h hecho; la invalidacion en la ingesta de la app y el borrado va en la 14; falta medir el render. Nube N2 (2026-10-27): no se tomó; que `/market` no lea `jd_text` exige guardar los candidatos (tabla o columna nueva), o sea migración. Nube N4 (2026-10-30): salteado por lo mismo; la propuesta (tabla `market_candidates` con RLS, calculada en `recomputeMarketForUser`, invalidación por fingerprint de ofertas) está en el issue #241. Además: no hay índice `(user_id, created_at)` en `jobs` (sí `jobs_user_first_seen`)
- **Por que:** `getMarket` trae y tokeniza los JD de las ultimas 300 ofertas en cada request (`force-dynamic`). Con varios usuarios es CPU y base por cada visita.
- **Que:** calcular los candidatos una vez por usuario y guardarlos (en el snapshot semanal de mercado o en cache por usuario con invalidacion al ingerir ofertas); `/market` solo los lee. Verificar indice `(user_id, created_at)` en `jobs`.
- **Acepta:** `/market` no lee `jd_text`; test de que los candidatos se recalculan al cambiar las ofertas; tiempo de render medido antes y despues.

### JS-090 · `htmlToText`: entidades con nombre ✅ done 2026-10-27
`deps:` — · `est:` XS · `estado:` done (nube N2, PR #242, mergeado 2026-10-27): acentos, eñe, portugués y puntuación; distingue mayúsculas salvo las básicas
- Solo decodifica unas pocas (`amp`, `lt`, `nbsp`...): `&eacute;` y similares quedan crudas. Ampliar la tabla cuando una fuente real las traiga.
- **Acepta:** test con las entidades nuevas.

### JS-056 · Tope de score por cantidad de gaps must
`deps:` JS-052 · `est:` 2 h · `estado:` todo (no bloquea)
- Surge de Empresa H (golden id 9) el 2026-09-24: el modelo le puso **5 con seis gaps must** (NestJS, Vue, MongoDB, Redis, Terraform, AWS Beanstalk). Lo que la mantenia en `descartar` era la suma de `cloud_must_penalty` + `english_fluent_penalty`, o sea una casualidad: la penalizacion de infraestructura estaba tapando un sobre-score del modelo, no midiendo viabilidad. Al sacar la de ingles (JS-052, opcion C) el disfraz se adelgaza.
- Regla nueva en `decide()`: con N o mas gaps `must` del stack central, tope de score. Parametrizada en `CriteriaRules` para poder moverla sin deploy.
- **Como medir N:** `pnpm evals recompute` sobre las corridas ya guardadas, barriendo N = 3, 4, 5, 6. **Primero sobre las anclas `human` (26)**, que son la evidencia no circular; las `assisted` solo como control. Se elige el N mas chico que no empeore `false_apply` ni `action_acc` en las human.
- **Acepta:** el id 9 vuelve a `descartar` por la regla de gaps y no por la penalizacion de cloud; `false_apply` sigue en 0 sobre las human.

### JS-053 · Agente de postulaciones con revisión humana
`deps:` JS-035 (JS-032 queda reemplazado en versión liviana por `candidate_facts`) · `estado:` Fase 1 ✅ done 2026-09-28 · Fase 2 ✅ done 2026-10-07 (ronda 04, PR #39) sin persistir borradores sin aprobar; falta la prueba manual
- Surge del 2026-09-23, al corregir el evaluador (JS-052): responder formularios de postulación sin un contexto verificable lleva a afirmar cosas que el perfil no respalda.
- ADR-004 sigue vigente en las dos fases: se redacta, no se postula ni se navega LinkedIn. Nada se manda solo.

**Fase 1 · Contexto por MCP, sin LLM en el servidor (done).** Claude (chat) responde formularios de postulación con el contexto de la app en vez de su memoria; la persona aprueba cada respuesta.
- **Tablas (migración 0015, RLS de dueño):** `candidate_facts` (proyecto, afirmación, métrica, fuente obligatoria, `verificable | autodeclarado`, activo), `application_settings` (disponibilidad, contratación, derecho a trabajar, links; sueldo, ubicación e inglés se leen de `profiles`), `answer_bank` (pregunta normalizada + idioma únicos, oferta de origen) y `application_answers` (formulario final por oferta, se reemplaza entero). En `answer_bank` y `application_answers` la policy exige además que la oferta sea del usuario: la FK se chequea como dueño de la tabla y no pasa por RLS.
- **Tools MCP:** `get_candidate_profile(job_id?)`, `list_answers(query?, lang?)` (con `source_job_id` y fechas), `save_answer`, `save_application_answers(job_id, qa[])`. Ninguna escribe hechos del perfil: los carga la persona con `pnpm applicant:sync` desde `fixtures-private/applicant.json` (diff sin `--apply`, confirmación contra base remota, no carga un archivo con `COMPLETAR`, lo que sale del archivo se desactiva).
- **Lo no cargado se marca:** sin hechos, `get_candidate_profile` devuelve `sin_hechos_cargados` en vez de una lista vacía; sin respuestas fijas, `sin_respuestas_fijas_cargadas`; un campo fijo vacío, `SIN CARGAR`. Una lista vacía o un null el modelo los lee como permiso para completar.
- **Sueldo a pedir (`salaryAsk`, pipeline), en este orden:** `part_time` (menos de 30 h semanales o título con part-time, part time, fractional, medio tiempo, media jornada: solo marca) → `no_normalizable` (por hora, anual, montos sin período, nota en pesos u otra moneda, nota con montos sin moneda) → `piso_inconsistente` (el piso de `profiles` y el de los criterios activos no coinciden) → `bajo_piso` (todo el rango bajo el piso) → `pedir` max(mínimo, piso), o el piso si no hay rango. Solo `pedir` trae número.
- **Piso:** configurable en `profiles.salary_floor_usd` y en `salary_floor_usd_monthly` de los criterios activos; se cambia siempre en los dos a la vez (si no, la tool devuelve `piso_inconsistente`). El valor real no está en el repo. En el evaluador no mueve ninguna acción del golden por sí solo: `decide()` y el prefiltro no usan el piso; lo usan el prompt (vía perfil) y el pre-score sin LLM.
- **Probado:** 53 tests de pipeline (normalización, orden del banco, sueldo, archivo y plan de sincronización), 17 de integración de adapters (tools, marcas de lo no cargado y `applicant:sync`), el caso JS-053 en `rls.integration.test.ts` (B no ve nada de A y no cuelga filas propias de una oferta de A) y un smoke local del handler real de `/api/mcp` con token de desarrollo (la preview de Vercel no tiene `MCP_TOKEN`).

**Fase 2 · Parseo del formulario y agente en la app (todo, sin implementar).**
- Pegar el formulario (texto o HTML) en el detalle de la oferta; un parser determinista separa preguntas y tipo de campo (texto, opción, número), y falla cerrado a "pegalo por partes" si no reconoce la estructura. El HTML pegado se muestra solo en `iframe` con `sandbox` vacío.
- Tarea LLM `draft_application_answers` registrada en `model_routing`, prompt versionado en `packages/prompts`: recibe preguntas + `get_candidate_profile` + `list_answers` y devuelve borradores con la fuente de cada afirmación (clave de `candidate_facts`). Las respuestas fijas y el sueldo no pasan por el modelo.
- UI de revisión: cada respuesta se aprueba, edita o descarta; al aprobar va a `answer_bank`, y el formulario final a `application_answers`. Botón "copiar todo"; nunca "enviar".
- **Acepta (Fase 2):** con un formulario de ejemplo anonimizado, ninguna respuesta afirma algo sin clave de `candidate_facts` que la respalde (test sobre la salida del prompt con el LLM falso) y las respuestas fijas salen idénticas a `application_settings`.

### AG · Asistente que lee, explica y propone (Fase 7, etapa 3)
`deps:` C-11 (planes) · `estado:` en curso (nube N1, 2026-10-27), detrás de `ASSISTANT_ENABLED=admin`
- Regla única: ninguna herramienta escribe. Las `propose_*` devuelven una diferencia antes/después; la persona la carga en el formulario y guarda con la Server Action de esa pantalla.
- **AG-0** · `packages/pipeline/src/agent/**`: topes (10 turnos, 6 pasos, 600 tokens de salida, 12.000 de entrada, USD 0,12 por charla, cupo mensual por plan), contexto de pantalla, tools y `activeToolsFor`, diffs por destino con regla de fundamento, historial y detección de CV · done 2026-10-27 (PR draft).
- **AG-1** · `streamAgent` en `packages/adapters/src/llm/agent.ts`: bucle propio de un paso por vuelta, deadline de 50 s, una fila de `llm_calls` por paso sin contenido, una propuesta por turno, modelo desde `model_routing` (`assistant_chat`) y fake guionado para `LLM_DEMO` · done 2026-10-27 (PR draft).
- **AG-3** · ruta `/api/assistant` (mismo origen, sesión, gate `ASSISTANT_ENABLED=admin` + `ADMIN_EMAILS`, topes desde `llm_calls`, CV fuera del modelo, NDJSON), tools sobre `apps/web/lib/*`, botón «Asistente» y panel, tarjeta de diferencia con «Cargar en el formulario» / «Descartar» y e2e `85-asistente` con el modelo simulado · done 2026-10-27 (PR draft). Faltan los prompts `assistant_chat@v1` y `assistant_propose@v1` en `packages/prompts` y la fila `assistant_chat` en `model_routing`: sin ellos, fuera del modo demo, falla cerrado.
- **AG-5** · propuestas de acciones como tarjetas-formulario: `propose_status_change` (marcar aplicada, entrevista, oferta, rechazada, descartada o cerrada con `changeStatusAction`; «aplicada» solo marca, nunca postula) y `propose_new_job` (alta manual prellenada con lo que la persona escribió literal, con `createManualJobAction`); fundamento del evento por palabras de la persona y e2e `86-asistente-acciones` · done 2026-10-27 (PR draft).

### JS-040 · SST y migración 3a (workers a Lambda)
### JS-041 · Onboarding de terceros, BYOK, planes
### JS-042 · Recruiter CRM y follow-ups
### JS-043 · Interview prep por oferta
### JS-044 · Application Kit RAG

## Bloque 7 — Beta y pre-piloto (rondas 40 a 122, del 12/10 al 24/10)

Resumen por tema de lo mergeado en ese período. Un ítem por tema, no uno por PR. «Mergeado» no implica «migración aplicada en producción»: las migraciones las aplica Mauro aparte.

### Onboarding, guía y primer valor
- **Onboarding** con varias modalidades, idioma de ofertas, país por nombre y skills más claras · done 2026-10-20 · #121. Un error de validación ya no borra lo cargado · #119.
- **Primeros pasos y guía** dentro de la app · done 2026-10-20 · #92 y #139. Textos sin jerga, `/jobs` vacío que orienta y navegación a 360 px · #114.
- **Textos para el piloto:**
  - carreras, invitación, ubicación, Gmail y criterios · done 2026-10-21 · #169;
  - el onboarding terminado aterriza en «Hoy» · #173;
  - `/applications` sin jerga al empezar · #175 (2026-10-23).
- **Primer valor en menos de 3 minutos (C-17):**
  - e2e cronometrado · #193;
  - la lista primero y el aviso de email después · #190;
  - al crear la cuenta se entra directo · #199 (2026-10-23).

  Quedan R1, R3 y R5, que esperan el #171.

### «Hoy», seguimiento y postulaciones
- **Pantalla «Hoy»** como aterrizaje después del login · done 2026-10-21 · #165 y #166.
- **«Para hacer seguimiento»** en `/applications`, en el menú y en «Hoy» · done 2026-10-23 · #155 y #188.

### Perfil, evaluador y prefiltro
- **«Tu perfil» en Ajustes** · done 2026-10-20 · #129. Al cambiar modalidad, país o idioma se vuelven a prefiltrar los avisos sin evaluar · #135.
- **Decide:** si la persona acepta la modalidad del aviso, el bloqueador del modelo pasa a riesgo · done 2026-10-21 · #134.
- **Un aviso que exige residir en otro país se descarta** · done 2026-10-20 · #106. Más patrones de licencia de otro país · #208 (abierto).
- **Evaluador:**
  - checklist de requisitos del aviso; salario, jornada y seniority en código · done 2026-10-21 · #147;
  - seguimientos · #150, #151 y #153;
  - la demo muestra «Requisitos del aviso» · #161.
- **Lectura de CV**, detrás de `CV_IMPORT_ENABLED` (apagado):
  - pipeline puro · #130;
  - orquestación · #160;
  - una lectura cortada por tiempo no consume el cupo · #162;
  - el código del CV pasa a carril rojo · #131.

### Pool, fuentes y carreras
- **Selección de primeras ofertas** que calzan con puesto, nivel y país · done 2026-10-16 · #90 y #96.
- **Fuentes:**
  - aviso de muro de pago y link al sitio de la empresa · #107;
  - Get on Board suma operaciones y publicidad (ADR-020) · #145;
  - fichas de fuentes · #152;
  - Teamtailor por feed RSS, integrado y apagado · #196, con la migración 0041 · #200 (2026-10-23).
- **Idioma en el pool**, chip «En español», y el inglés no es brecha en avisos en español · done 2026-10-21 · #144. Además: `pnpm pool:rehint` · #146; dry-run con desglose · #168.
- **Carreras:**
  - «Producto y proyectos» se parte en cuatro · #140;
  - Data Engineering y Solutions Engineering · #148;
  - Ventas B2B, Atención al cliente y licencias de otro país (ADR-022) · #154;
  - Finanzas y contabilidad, y Asistencia y operaciones (migraciones 0043 y 0044) · #202;
  - títulos sin carrera y vetos entre carreras vecinas · #210 (2026-10-24).
- **Personas ficticias para `pool:explain`** · #211. Siguen #222 y #225 (abiertos).
- **Alertas:** guía «Qué alertas crear» · #149; palabras sugeridas · #157; «Qué portal te sirve» · #156 (2026-10-21).

### Mercado, plan y encaje
- **Mercado por carrera en `/market`** · #101. Sueldos por carrera en dos mercados · #122.
- **«Tu encaje»:**
  - funciones puras · #180;
  - `/encaje` y tarjeta en «Hoy» · #185;
  - cruce con el detalle · #187;
  - se actualiza al guardar · #203 (2026-10-23).
- **Plan de estudio (C-3):**
  - simulador y ruta, puros · #183;
  - «Si aprendés…» en `/plan` · #186;
  - selector de horas · #214;
  - «Esta semana» · #217;
  - el curso que lleva a nivel 2 · #216;
  - «el evaluador te la marcó» · #218;
  - «Ver 3 ofertas» · #220 (2026-10-24).
- **Catálogo de cursos (C-3):**
  - verificador de links, puro y sin red · #215;
  - proveedores, todo «a verificar» · #219;
  - más rangos rechazados en la validación de URLs · #221 (2026-10-24).

  Quedan en carril rojo: columnas, CLI y cron.

### Cuentas, planes y métricas de la beta
- **Planes y topes en un solo lugar,** y `/precios` detrás de `PRICING_ENABLED` · done 2026-10-23 · #176. Plan de cada persona con vencimiento (migración 0039) · #179.
- **Marca en un solo lugar** · done 2026-10-23 · #178.
- **Carrera «madura» o «en pulido»** y tablero de la beta para el admin · done 2026-10-23 · #197. Cupos de fundador por carrera · #207 (abierto).
- **Instituciones:** módulos puros de B2B · done 2026-10-23 · #184.
- **Invitaciones y lista de espera** · #112 y #97.
- **Legal:**
  - volver a aceptar los términos cuando cambia la versión · #127;
  - privacidad y términos para la beta · #158;
  - contacto para borrar datos · #113.

### Endurecimiento y operación
- **Endurecimiento de las acciones del servidor y del restablecimiento de contraseña** · done 2026-10-23 · #174 y #182 (migración 0040).
- **Endurecimiento del correo entrante y de los encabezados HTTP** · #110, #104 y #98. El MCP responde un error enseguida · #137.
- **Operación:**
  - presupuesto de tiempo del worker y `/api/cron/status` · #109;
  - carril verde · #120;
  - build local con Docker · #116;
  - demo guiada semanal · #132.
- **Rendimiento (C-7):**
  - #192, #194, #195 y #206;
  - seis índices (migración 0042) · #201;
  - tope del caché de «Si aprendés…» · #209;
  - sin prefetch en las listas ISR · #128.
- **Pantallas de error en español** · #100.

### Vitrina pública, documentación y calidad
- **Vitrina:**
  - portada, mercado y ofertas de muestra · #105;
  - revalidación · #111;
  - demo guiada · #115;
  - URL canónica y metadatos · #136;
  - `/en/how-its-built` · #141;
  - build con la URL de la app · #138;
  - imagen para compartir · #163;
  - SEO por carrera · #181.
- **Docs:** README · #133; ARCHITECTURE.md · #142.
- **Accesibilidad AA (axe):**
  - públicas · #143;
  - con sesión · #167;
  - registro y onboarding · #204;
  - admin y `/precios` · #212.
- **e2e y tests:**
  - specs sin dependencias de orden ni de caché · #205 y #213;
  - tests de cobertura de pipeline · #223;
  - recorrido de una persona nueva en Finanzas · #224 (abiertos).

### Hallazgos de la beta (H-1 a H-3)
- **H-1 · Avisos remotos limitados a otro país** (caso Canadá) · en revisión, PR #300 (`nube/c2-regla-pais`, C2-3): remoto + países que no incluyen el de la persona pasa de riesgo a bloqueador, salvo que el aviso acepte su país o su región. Antes, solo la frase literal «must be based in…» descartaba (ronda 66).
- **H-2 · Aviso del muro de pago de We Work Remotely** · done 2026-10-20 · `33f70e0`. Verificado el 2026-10-30 contra el código: `WWR_PAYWALL_NOTICE` (`packages/pipeline/src/pool/attribution.ts`) se muestra en `source-attribution.tsx` cuando alguna fuente del aviso es `wwr`, con el link al sitio de empleos de la empresa si la JD lo trae (`findAtsLinks`). Cubierto por el e2e `45-wwr-aviso.spec.ts`.
- **H-3 · «+ Cargar oferta» visible y pegar el aviso entero** · done 2026-10-20 · `0947dfb` y `66408e8`. Verificado el 2026-10-30: el botón «+ Cargar oferta» está junto al título de `/jobs` (`apps/web/app/(app)/jobs/page.tsx`) y `/jobs/new` ofrece «Pegar el aviso entero» (`paste-form.tsx`, lectura con reglas simples en el navegador). Cubierto por los e2e `47-textos-y-navegacion.spec.ts` (botón visible, 44 px, lleva a `/jobs/new`) y `42-pegar-aviso.spec.ts`.
- **Tanda C2 de la beta** (2026-10-30, todos en draft, sin mergear): C2-3 regla de país · #300; C2-2 «A tu favor» y «Te falta o te frena» · #303; C2-1 CV para ATS abierto a todos, con topes por persona y por mes (3 CV, 40 turnos) · #304.
- Los e2e no se corrieron en la nube (necesitan Docker/Postgres; CLAUDE.md §9): la confirmación sale de leer el código y los specs; los corre el CI.

## Bloque 8 — Carreras de la beta (tanda C1, 2026-10-30)

Seis carreras de la beta cerrada (ADR-027). Los PR están en draft y apilados: se mergean en orden C1-1 a C1-6. «Done» acá es «hecho y con CI en verde en el PR»; ningún PR está mergeado y las migraciones **no** se aplicaron (las aplica Mauro con `pnpm db:migrate` antes del merge).

### C1-1 · ADR-027 y chips de especialidad
`deps:` — · `estado:` done (2026-10-30; PR #288)
- `docs/adr/027-carreras-de-la-beta-y-chips-de-especialidad.md` y `skills/specialties.ts` (`ROLE_SPECIALTIES`) con el test de cobertura: la unión de los términos de los chips es `TITLE_TERMS[role]`.
- **Acepta:** el test de cobertura pasa para las 6 carreras.

### C1-2 · Claves nuevas
`deps:` C1-1 · `estado:` done (2026-10-30; PR #290; ⚠️ migraciones 0048 y 0049 sin aplicar)
- `abogacia`, `administracion_empresas`, `comunicacion` y `relaciones_internacionales` al final de `ROLE_KEYS`, sin listar (`UNLISTED_ROLE_KEYS`); rótulos nuevos de `finanzas_contabilidad` y `marketing_digital`; 30 skills; `HEADLINE_KEYWORDS`; `rls/0012`.
- **Acepta:** `taxonomy.test.ts` (ningún término compartido) y el test de integración de las migraciones en el CI.

### C1-3 · Títulos, exclusiones, vetos y chips
`deps:` C1-2 · `estado:` done (2026-10-30; PR #291)
- `TITLE_TERMS`, `TITLE_EXCLUSIONS`, `TERM_EXCLUSIONS` (nuevo), `VETO_TERMS` y chips de las 6 carreras, un commit por carrera.

### C1-4 · Arreglos del prefiltro (carril rojo)
`deps:` C1-3 · `estado:` done (2026-10-30; PR #292)
- `exemptFor` de «abogad» y «administrativ», cargos propios «manager», alias de AR en licencias y regla de multinivel. Golden y adversarial sin cambios (probado).

### C1-5 · Palabras de alerta
`deps:` C1-4 · `estado:` done (2026-10-30; PR #294)
- `ALERT_KEYWORDS` de las 6 carreras; cada palabra es un título que la carrera reconoce.

### C1-6 · Mapeo de categorías de fuentes
`deps:` C1-5 · `estado:` done (2026-10-30; PR #295)
- `SOURCE_CATEGORY_ROLES` de Jobicy y We Work Remotely, más vetos cruzados en `title-fit.ts`. El adapter que las pide es de otro PR (#289).

### CI

Última corrida completa del e2e en #403 antes del cierre: **664 ok, 0 fallas** (6 salteados).

### MCP-1 · Tokens personales del MCP
`deps:` R4-15 (lista de testers) · `est:` 1 día · `estado:` done 2026-11-09, en PR rojo (Mauro mergea)
- Tabla `mcp_tokens` (hash sha256, vence a los 30 días, revocable, máximo 3 activos) con RLS y `mcp_token_user()` (SECURITY DEFINER, tope de 60 llamadas por minuto). El MCP resuelve el usuario por request; se eliminó el `cachedUserId` global. `MCP_TOKEN` sin cambios.
- Pantalla `/settings/conexiones` solo para testers con `MCP_USER_TOKENS=testers`. `readOnlyHint` en las 6 tools de lectura. ADR-032.
- **Mauro:** aplicar 0060 y `rls/0019` en Neon antes del merge; en Vercel, `MCP_USER_TOKENS=testers`, `MCP_ALLOW_QUERY_TOKEN=1` y el email de Ani en `ASSISTANT_TESTER_EMAILS`.
- **Fuera:** OAuth, antes de abrir el MCP a la beta.

### Pendiente después de la tanda
- Mauro: `pnpm db:migrate` (0048 y 0049), merge en orden y deploy; después `pnpm pool:rehint --remote` (sin y con `--apply`) y medir volumen para sacar cada carrera de `UNLISTED_ROLE_KEYS`.
- Golden por carrera con avisos reales (evals pagos) y selección de personas por chip: tanda siguiente.

## Bloque 9 — Beta cerrada: cobro, seguridad, áreas y dominio (tanda C3, 2026-10-31)

Cuatro PR de la nube, todos en draft y con base `ronda/integracion-t1-g2` (#309). «Done» acá es «hecho y con CI en verde en el PR»; ningún PR está mergeado y las migraciones **no** se aplicaron (las aplica Mauro con `pnpm db:migrate` antes del merge). **Orden de merge: #312 → #314 → #315** (cada una sale de la anterior); #316 es independiente. La beta abre el jueves 26/11; precio ARS 20.000 o USD 15 por mes, sin garantía, cobro con link de Mercado Pago y activación manual.

### C3-1 · Cobro de la beta
`deps:` — · `estado:` done (2026-10-31; PR #312; ⚠️ migración 0051 + `rls/0010` y `rls/0015`)
- Plan «Beta» (`lista`: ARS 20.000 por mes, USD 15 de referencia, 30 días por pago, sin «garantía»); `/precios` ofrece solo gratis y Beta. `plan-access.ts` (puro): estado del acceso, aviso a 3 días y fecha de fin al activar o renovar (nada se gasta antes del 26/11; renovar suma días).
- Panel `/settings/planes` (admin): activar 30 días como pago o beca, ver quién tiene acceso y quitar el plan (`admin_plan_get/list/set`, `SECURITY DEFINER`, `app_admins`). Migración 0051: `profiles.plan_source` (`pago` | `beca`).
- La persona ve hasta cuándo llega su acceso en Ajustes y un aviso en la app a 3 días; al vencer rige el plan gratis y no se borra nada.
- **Sin hacer:** email de aviso (hace falta un cron en `.github/` y `plan_notified_at`); términos legales sobre pagos y devoluciones.

### C3-2 · Seguridad antes de cobrar
`deps:` C3-1 · `estado:` done (2026-10-31; PR #314; ⚠️ migraciones 0052 y 0053 + `rls/0001` y `rls/0003`)
- **JS-079** y **JS-116**: ya estaban resueltos en el código (ver la evidencia en cada ticket). **JS-115**: `inbound_emails.email_id` único + backfill. **JS-124**: se retiran las versiones 1 y 2 de la función de registro.

### C3-3 · Guardar las áreas de cada persona
`deps:` C3-2 · `estado:` done (2026-10-31; PR #315; ⚠️ migración 0054)
- `profiles.target_specialties` (`jsonb`, `null` = «Todas las áreas»), validación en pipeline, guardado en el onboarding y en «Tus puestos» (Ajustes). **Todavía no filtra avisos**: la propuesta (descartar con `jobMatchesSpecialties` en `pool/select.ts`) está en el PR y en ADR-027.

### C3-4 · Dominio listo para afiniajobs.com.ar
`deps:` — · `estado:` done (2026-10-31; PR #316; sin migración)
- `SITE_URL` única para canonical, sitemap, robots, Open Graph y links de emails; `LEGACY_HOSTS` redirige el dominio viejo al nuevo sin tocar `/api/*`. Pasos para Mauro en `docs/DEPLOY.md` («Pasar a afiniajobs.com.ar»). No se cambió ninguna variable en Vercel.

### Pendiente después de la tanda
- Mauro: `pnpm db:migrate` (0051 a 0054 y las policies de `rls/`), merge en orden, `MP_LINK_LISTA` y `PRICING_ENABLED=1` en Vercel cuando corresponda, y los pasos de `docs/DEPLOY.md` para el dominio.
- Decidir los textos de las áreas (hoy no filtran), el aviso por email del vencimiento y los términos sobre pagos.

## Reglas del backlog

- Techo semanal después del finde: 8 hs. Si el bloque 4 no está en producción en 2 semanas, se congela el bloque 5.
- Ningún ticket nuevo entra sin criterio de aceptación.
- Los tickets del bloque 5 se detallan cuando el bloque 4 esté done.

## Bloque 10 — Beta cerrada: avisos, lista de espera y carreras ocultas (tanda C4, 2026-10-31)

Cinco tareas de la nube, todas en draft. «Done» acá es «hecho y con CI en verde en el PR» (los e2e corren cuando el PR apunta a main); nada está mergeado y la migración **no** se aplicó. Esta sección va al final del archivo a propósito, para no chocar con la de la tanda C3 al mergear. Cadena de bases: C4-1 sale de `nube/c3-areas` (#315 → #314 → #312 → #309); C4-2, C4-3 y C4-4 salen de `ronda/integracion-t1-g2` (#309) y son independientes entre sí. La beta abre el jueves 26/11.

### C4-1 · Aviso por email antes de que venza el plan
`deps:` C3-1 · `estado:` done (2026-10-31; PR #320; ⚠️ migración 0055 + `rls/0010`)
- `profiles.plan_notified_at` (0055) y cron diario `15 12 * * *` en `cron.yml` (paso `plan-notices`) → `/api/cron/plan-notices`. Un email de texto por persona y vencimiento cuando le quedan 3 días o menos, con la fecha, el link de pago y qué pasa si no renueva (pasa al plan gratis y no pierde nada).
- Criterio puro en `pipeline/plan-expiry-notice.ts`; runner con reclamo atómico (`UPDATE … RETURNING`) en `adapters/billing/plan-expiry-notices.ts`. Tope diario `PLAN_NOTICE_DAILY_CAP` (default 30, máximo 80), sin PII en logs y sin enviar nada si faltan `RESEND_API_KEY` o `EMAIL_FROM`.

### C4-2 · Panel de la lista de espera
`deps:` — · `estado:` done (2026-10-31; PR #321; sin migración)
- `/settings/invitations`: filtros (carrera, origen, fecha, estado), contador por carrera, selección múltiple con tope (20 por defecto, máximo 100) y confirmación, mensaje de invitación con «la beta abre el jueves 26/11» y exportación a CSV (nombre, email, carrera, origen, fecha). No manda emails y no cambia cómo se guarda la lista. e2e `91-lista-espera-tanda` (sin correr).

### C4-3 · Cuándo mostrar cada carrera nueva
`deps:` — · `estado:` done (2026-10-31; PR #323; sin migración)
- `/settings/metricas`: tabla de `UNLISTED_ROLE_KEYS` con las ofertas nuevas de 30 días contra el umbral de 10 (ADR-022) y la marca «lista para mostrarse». Una consulta agregada a `public_jobs`. Sacar una carrera del modo oculto sigue siendo un cambio de una línea en `self-assessment.ts` (más dos tests de la lista).

### C4-4 · «Repetí la contraseña» (resto de JS-126)
`deps:` — · `estado:` done (2026-10-31; PR #324; sin migración)
- `setup` y `reset-password` usan el mismo rótulo que el registro; ajustados los e2e 05 y 06. Con esto JS-126 queda hecho salvo «sumar lo que salga del ensayo»; la línea de estado de JS-126 no se tocó para no chocar con la edición de la tanda C3 (#316).

### C4-5 · Revisión cruzada de los PRs de G3 y G4
`deps:` — · `estado:` done (2026-10-31; comentarios en #313, #317, #318, #319 y #322)
- **Bloqueantes de texto o de producto:** #318 (la guía manda a elegir en el selector carreras que están ocultas; pide cargar un CV por archivo que no existe; `/cv/armar` depende de `CV_CHAT_ENABLED=all`), #319 y #322 (prometen un link o una invitación antes del 26/11 a todo el que se anote; #322 además omite que el texto va a proveedores de IA y manda a `/precios`, que da 404 con `PRICING_ENABLED` apagado). #313 y #317 sin bloqueantes (GitGuardian marca un falso positivo en `register/page.tsx:61`).

### Pendiente después de la tanda
- Mauro: `pnpm db:migrate` (0055 y `rls/0010`) antes de mergear #320; `RESEND_API_KEY` **y** `EMAIL_FROM` con dominio verificado en Vercel para que salgan los avisos.
- Decidir antes del ensayo del 20/11 si las carreras ocultas de la beta salen de `UNLISTED_ROLE_KEYS` (hoy un invitado de abogacía, administración, comunicación o relaciones internacionales no la ve en el onboarding).

## Bloque 11 — Beta cerrada: carreras elegibles, guías, seguridad e integración de la noche (tanda C5, 2026-11-01)

Trece PRs nuevos de la nube (todos en draft, sin mergear; las migraciones **no** se aplicaron) y **un PR de integración** que junta todo lo abierto de la noche en `ronda/integracion-noche-1-11` (base `ronda/integracion-t1-g2`, #309). El detalle, las variables de Vercel y las decisiones están en el cuerpo de ese PR. Esta sección va al final del archivo a propósito.

### Fase 1 · Bloqueantes
- **C5-1 · Carreras de la beta elegibles al entrar** · `estado:` done (PR [#326](https://github.com/Malejo01/job-search-os/pull/326) sobre `nube/c3-seguridad`; e2e en [#327](https://github.com/Malejo01/job-search-os/pull/327) sobre `gemini/g3-ensayo`; sin migración, re-aplica `rls/0003`). `profileRoleGroups()` ofrece siempre `BETA_ROLE_KEYS` en el onboarding, «Tus puestos», las skills y el asistente; el mercado público y el sitemap siguen ocultándolas (ADR-022). La invitación que sale de la lista de espera precarga la carrera elegida al anotarse (`register_with_invitation_v3`, vía `waitlist.invitation_id`).
- **C5-2 · Guía del ensayo** · done ([#328](https://github.com/Malejo01/job-search-os/pull/328)). Sin carga de CV por archivo (no existe), carreras en sus grupos reales, pasos del onboarding con sus nombres.
- **C5-3 · Áreas sin promesa falsa** · done ([#330](https://github.com/Malejo01/job-search-os/pull/330) sobre `nube/c3-areas`). Texto honesto y baja de orden + marca `fuera_de_areas` detrás de `AREAS_FILTER_ENABLED` (apagado), sin descartar nada.

### Fase 2 · Valor para la beta
- **C5-4 · Personas e2e de las otras 4 carreras** · done ([#331](https://github.com/Malejo01/job-search-os/pull/331)): Agustina, Bruno, Rocío e Inés.
- **C5-5 · Auditoría de seguridad** · done ([#335](https://github.com/Malejo01/job-search-os/pull/335), informe `docs/seguridad/auditoria-beta-1-11.md`). Correcciones: topes de la lista de espera para el 11/11 ([#332](https://github.com/Malejo01/job-search-os/pull/332), re-aplica `rls/0006`) y contexto del chip de soporte sin textos de terceros ([#333](https://github.com/Malejo01/job-search-os/pull/333)).
- **C5-6 · Runbook del día de apertura** · done ([#336](https://github.com/Malejo01/job-search-os/pull/336), `docs/beta/runbook-apertura.md`).
- **C5-7 · Ahorro de Neon, parte 1** · done ([#337](https://github.com/Malejo01/job-search-os/pull/337)): caché del catálogo de skills (worker y web), sin `jd_shingles` en el detalle y la evaluación, candidatos de `/market` cada 6 h; evaluación de JS-102 como propuesta. Lo que depende de `pg_stat_statements` queda para el 3/11.

### Fase 3 · Después de la «cola vacía» de G4
- **C5-8 · Bloqueantes de texto de G4** · done: [#338](https://github.com/Malejo01/job-search-os/pull/338) (`/acceso`, sin prometer invitación), [#339](https://github.com/Malejo01/job-search-os/pull/339) (`/ayuda`: sin promesas, privacidad con proveedores de IA, `/precios` solo con `PRICING_ENABLED`) y [#340](https://github.com/Malejo01/job-search-os/pull/340) (Gmail: la cuenta del asunto no habilita la confirmación, JS-127). Revisados sin bloqueantes propios: #329 y #325.
- **C5-9 · PR de integración** · rama `ronda/integracion-noche-1-11`.

### Pendiente después de la tanda
- Mauro: `pnpm db:migrate` (0051 a 0055 y las policies `rls/0001`, `0003`, `0006`, `0010`, `0015`) antes del merge; variables de Vercel (ver el PR de integración); runbook y checklist.
- Antes del 26/11: sacar de la lista de espera a quienes Ani no elija; antes del 13/11, actualizar `docs/legal/datos-por-proveedor.md` (hallazgo L-1 de la auditoría).
- Ronda del 3/11: medición con `pg_stat_statements` y lo que pide migración (persistir el idioma del aviso, `market_candidates`, índice de `inbound_emails` por persona).

## Bloque 12 — Textos de la beta, marca, ahorro de Neon, carreras por umbral y kit del QR (tanda C6, 2026-11-02)

Seis tickets de la nube en una noche: cinco PRs en draft hacia `ronda/integracion-c6` (más uno apilado que **no** entra), la limpieza de los PRs viejos y **un PR de integración** `ronda/integracion-c6` → `main`. Nada se mergeó a `main`; la migración **no** se aplicó. El detalle, las migraciones, los paths rojos y las «Decisiones para Mauro» están en el PR de integración.

- **C6-1 · Textos públicos alineados con la beta** · `estado:` done, 2026-11-02 (PR [#345](https://github.com/Malejo01/job-search-os/pull/345)). `/ayuda` habla del Plan Beta (por invitación, pago) y del gratis como lo que queda al vencer, y cierra con cupo limitado; `/acceso` pone las 6 carreras de la beta primero en el grupo «Carreras de la beta» (`waitlistRoleGroups`); «Datos curiosos» de `/mercado` respeta las carreras ocultas; `/demo` sin «probarlo» ni «cargá el tuyo».
- **C6-2 · Nombre del producto en un solo lugar** · done, 2026-11-02 ([#346](https://github.com/Malejo01/job-search-os/pull/346)). La UI ya leía `PRODUCT_NAME`; faltaba el `User-Agent` de las fuentes y tres e2e que repetían el nombre. Guarda `brand.test.ts`. El valor no cambia. **Aparte, sin integrar:** [#347](https://github.com/Malejo01/job-search-os/pull/347) cambia el valor a «AfinIAJobs» (NO MERGEAR hasta aprobar la marca el 6/11).
- **C6-3 · Ahorro de Neon, parte 2** · done, 2026-11-02 ([#348](https://github.com/Malejo01/job-search-os/pull/348), **migración 0056**, carril rojo). La selección de candidatas del pool leía 300 filas completas (~70 KB c/u, ~21 MB por llamada): ahora lee columnas acotadas y la fila completa solo de las elegidas, por tandas de 25. Índice `job_queue_job_id` sobre `payload->>'jobId'` para el conteo de la cola. `/fit` con `decision->'checklist'`. `docs/neon/neon-stats.sql` (solo lectura) para medir antes y después. Estado de la auditoría en `docs/neon/auditoria-consultas.md` §5.
- **C6-4 · Carreras de la beta en público por umbral** · done, 2026-11-02 ([#349](https://github.com/Malejo01/job-search-os/pull/349), ADR-029). Aparecen solas al llegar a 10 ofertas (mismo conteo que la tabla de `/settings/metricas`), con caché de 1 hora, dos listas de override en código y falla cerrado. Vuelve innecesario el PR de una línea de #343.
- **C6-5 · Kit del QR para el 11/11** · done, 2026-11-02 ([#350](https://github.com/Malejo01/job-search-os/pull/350), `docs/beta/voces-jovenes/`): dos QR (dominio nuevo y respaldo) en SVG y PNG, README y checklist del evento.
- **C6-6 · Limpieza de PRs viejos** · done, 2026-11-02: 38 PRs en draft (#290–#296 salvo el 293, #305–#307, #312–#340) cerrados porque su contenido ya estaba en `main` por #309 (9 PRs) o #341 (29 PRs), verificado con `git merge-base --is-ancestor` y `git cherry`. Sin tocar #69, #308 (ReliefWeb, aplazado), #343 y #344.
- **C6-7 · PR de integración** · rama `ronda/integracion-c6`.

### Pendiente después de la tanda
- Mauro: `pnpm db:migrate` (0056) antes del merge; después de mergear, correr `docs/neon/neon-stats.sql` y comparar con la foto del 1/11.
- 9/11: decidir qué QR se usa el 11/11 (README del kit). 6/11: aprobación de marca; recién ahí se mergea #347 y se cambian los textos legales (13/11).
- Ronda del 3/11 (lo que quedó de la auditoría de Neon y pide migración): persistir el idioma y el nivel de inglés del aviso en `public_jobs` (hoy `readCareerMarketInput` lee el texto), `market_candidates`, índice de `inbound_emails` por persona, y los shingles del dedup.
- Si algún día se quiere que una carrera ya publicada se oculte sola al bajar de 10 ofertas: sumarla a `PUBLIC_THRESHOLD_ROLE_KEYS` (ADR-029).

## Bloque 13 — Rebranding AfinIAJobs y rediseño (tanda C7, 2026-11-02 al 03)

Una noche de la nube: la marca AfinIAJobs (nombre, logo, paleta, tipografías, íconos, imágenes y emails) y el rediseño de toda la app según `docs/ux/rediseno-afiniajobs/`. Cada ticket fue un PR `[nube C7]` en draft hacia `ronda/integracion-c7`, mergeado con `--no-ff` con su CI en verde, y **un solo PR de integración** hacia `main` (#353). Nada se mergeó a `main`; **ninguna migración nueva** (la 0056 viene de C6). El detalle, los paths rojos y las «Decisiones para Mauro» están en #353.

### Fase 1 · Marca
- **C7-1 · Tokens y tipografías** · `estado:` done, 2026-11-02 ([#352](https://github.com/Malejo01/job-search-os/pull/352)). Paleta del manual en claro y oscuro con los mismos nombres semánticos, foco naranja, radios 12/16, Sora y Manrope (`next/font/local`, archivos en el repo), tema por defecto del dispositivo y selector en Ajustes → Apariencia.
- **C7-2 · Nombre, logo e imágenes** · done ([#354](https://github.com/Malejo01/job-search-os/pull/354), reemplaza a #347). `BRAND.name` = AfinIAJobs, `<Logo>` único, favicon, apple-icon, manifest, imágenes OG/X con fuentes del repo, emails con encabezado de marca y test que falla con el nombre mal escrito.
- **C7-3 · Legales con el nombre nuevo** · done ([#355](https://github.com/Malejo01/job-search-os/pull/355), carril rojo). Solo el nombre; `TERMS_VERSION` 2026-11-02: todas las cuentas vuelven a aceptar.

### Fase 2 · Pantallas
- **C7-4 · Componentes base** · done ([#356](https://github.com/Malejo01/job-search-os/pull/356)). Botones, campo, avisos, ScoreBadge, etiquetas, 12 íconos de M6 y tarjeta de oferta.
- **C7-5 · Header y navegación** · done ([#357](https://github.com/Malejo01/job-search-os/pull/357)). Header tinta con la sección activa en naranja, menú del celular y avatar con iniciales; chip de soporte que no tapa botones.
- **C7-6 · Ofertas (P1)** · done ([#358](https://github.com/Malejo01/job-search-os/pull/358)). **C7-7 · Hoy (P2)** · done ([#359](https://github.com/Malejo01/job-search-os/pull/359)). **C7-8 · Sin descripción (P3)** · done ([#360](https://github.com/Malejo01/job-search-os/pull/360)). **C7-9 · Celular y oscuro (P4)** · done ([#361](https://github.com/Malejo01/job-search-os/pull/361), e2e 102).
- **C7-10 · El resto de las pantallas** · done ([#362](https://github.com/Malejo01/job-search-os/pull/362) y [#368](https://github.com/Malejo01/job-search-os/pull/368)). `/acceso` para el QR, portada, cuenta, headers tinta en lo público y campos internos de 2 px.
- **C7-11 · Voz y tono (M7)** · done ([#363](https://github.com/Malejo01/job-search-os/pull/363)).

### Fase 3 · Beta
- **C7-12 · Pago solo con la invitación** · done ([#364](https://github.com/Malejo01/job-search-os/pull/364), carril rojo). `/precios` sin link; el mensaje de invitación lleva precio, 30 días y `MP_LINK_LISTA`.
- **C7-13 · Demo para el 11/11** · done ([#365](https://github.com/Malejo01/job-search-os/pull/365)). `/demo/contaduria`, datos inventados y fijos.
- **C7-14 · Capacidad para 25 personas** · done ([#366](https://github.com/Malejo01/job-search-os/pull/366), `docs/beta/capacidad.md`).
- **C7-15 · Accesibilidad y rendimiento** · done ([#367](https://github.com/Malejo01/job-search-os/pull/367), carril rojo). Legales legibles en oscuro, `/acceso` sin salto de layout, 44 px; e2e 104.

### Reserva
- **R-1 · `/settings/marca`** · done ([#369](https://github.com/Malejo01/job-search-os/pull/369)). **R-2 · Onboarding sin jerga** · done ([#370](https://github.com/Malejo01/job-search-os/pull/370), textos para Ani en el PR). **R-3 · Error y 404** · done ([#371](https://github.com/Malejo01/job-search-os/pull/371)). **R-4 · Lógica del score con tests** · done ([#372](https://github.com/Malejo01/job-search-os/pull/372)). **R-5 · Revisión del diff** · ver #353.

### Pendiente después de la tanda
- Mauro: revisar y aplicar `pnpm db:migrate` (0056 de C6) antes del merge de #353; cargar `MP_LINK_LISTA`, `PRICING_ENABLED=1` y `LLM_DAILY_CAP_USD=4` (ver `docs/beta/capacidad.md` §6).
- Ani: revisar la marca en `/settings/marca` y los textos de R-2; los cambios salen de tokens, `components/brand/logo.tsx` y `brand.ts`.
- Si la cola de evaluación crece la primera semana: cron de `evaluate` cada hora (PR rojo, `docs/beta/capacidad.md` §2).
- Confirmar si los emails entrantes cuentan en el cupo gratis de Resend.

## Bloque 14 — 11/11, apertura de la beta y carreras (tanda C8, 2026-11-03 al 04)

Una noche de la nube, sin supervisión: lo que hace falta para el evento del 11/11 (Voces Jóvenes), la apertura de la beta del 26/11 y las 6 carreras no tech. Cada ticket fue un PR `[nube C8]` en draft hacia `ronda/integracion-c8`, mergeado con `--no-ff` con su CI en verde, y **un solo PR de integración** hacia `main` ([#376](https://github.com/Malejo01/job-search-os/pull/376)). Base: `ronda/integracion-c7` (#353 seguía abierto). Nada se mergeó a `main`; **tres migraciones nuevas (0057, 0058, 0059), ninguna aplicada**. Reglas, decisiones y variables en `docs/beta/tanda-c8.md`; paths rojos y «Decisiones para Mauro» en #376.

### Evento del 11/11
- **C8-1 · Reglas de la tanda** · `estado:` done, 2026-11-03 ([#375](https://github.com/Malejo01/job-search-os/pull/375)). `docs/beta/tanda-c8.md`.
- **C8-2 · Embudo de `/acceso`** · done ([#377](https://github.com/Malejo01/job-search-os/pull/377), **migración 0057** + `rls/0016`). Visitas, formularios empezados, carrera, envíos y topes por hora y origen, sin datos personales; panel en `/settings/metricas`. `ACCESO_FUNNEL_ENABLED`.
- **C8-3 · `/acceso` aguanta la sala** · done ([#378](https://github.com/Malejo01/job-search-os/pull/378)). Topes del evento por ventana (`WAITLIST_EVENT_WINDOW`, solo `?origen=voces-jovenes`), confirmación «Qué sigue» (anotarse no garantiza lugar) y botón para compartir. `rls/0006` refactorizado.
- **C8-4 · Guion de la demo** · done ([#379](https://github.com/Malejo01/job-search-os/pull/379)). `docs/beta/voces-jovenes/guion-demo.md`.
- **C8-14 · Segunda auditoría de seguridad** · done ([#391](https://github.com/Malejo01/job-search-os/pull/391)). 0 bloqueantes; tope por IP del evento a 120. `docs/seguridad/auditoria-beta-3-11.md`.

### Primeros días de la beta
- **C8-5 · «Empezá acá» en `/hoy`** · done ([#380](https://github.com/Malejo01/job-search-os/pull/380)). `START_HERE_ENABLED`.
- **C8-6 · Ayuda en contexto** · done ([#381](https://github.com/Malejo01/job-search-os/pull/381)). «¿Qué es esto?» en puntaje, a favor / te falta, sin descripción, CV y áreas. `HELP_TIPS_ENABLED`.
- **C8-7 · Email de bienvenida al activar el plan** · done ([#382](https://github.com/Malejo01/job-search-os/pull/382), arreglo [#386](https://github.com/Malejo01/job-search-os/pull/386)). Una sola vez, en `after()`; vista previa en `/settings/marca`. `WELCOME_EMAIL_ENABLED`.
- **C8-11 · Semáforo de la mañana** · done ([#387](https://github.com/Malejo01/job-search-os/pull/387)). `/settings/salud`: evaluaciones, ingesta, emails contra el tope de Resend y gasto de 24 h. Sin migración.
- **C8-13 · Ensayo del 23 y 24/11** · done ([#389](https://github.com/Malejo01/job-search-os/pull/389)). `docs/beta/ensayo.md` y e2e 110 con una persona por carrera.
- **C8-17 · Triage del feedback** · done ([#393](https://github.com/Malejo01/job-search-os/pull/393), **migración 0059** + `rls/0018`). Filtros, estado y CSV en `/settings/feedback`. `FEEDBACK_TRIAGE_ENABLED`.

### Carreras no tech
- **C8-8 · Golden sintético de carreras** · done ([#383](https://github.com/Malejo01/job-search-os/pull/383)). 48 avisos inventados en `packages/pipeline/test/fixtures/carreras/`, fuera de `evals/` para no disparar el job pago.
- **C8-9 · Prefiltro contra el golden** · done ([#385](https://github.com/Malejo01/job-search-os/pull/385)). 46/48 → 48/48 («cuentas a pagar», «redes sociales»).
- **C8-10 · Fuentes no tech** · done ([#384](https://github.com/Malejo01/job-search-os/pull/384)). Ningún adapter nuevo; ADR-030 (The Muse) propuesto.

### Textos, legales y Neon
- **C8-12 · Legales** · done ([#388](https://github.com/Malejo01/job-search-os/pull/388)). `pnpm legal:check`, `docs/legal/preguntas-ani.md` y datos por proveedor. Los marcadores siguen sin completar (respuestas de Ani hasta el 13/11).
- **C8-15 · Neon, ronda 3** · done ([#390](https://github.com/Malejo01/job-search-os/pull/390), **migración 0058** + `rls/0017`). Idioma del aviso persistido en `public_jobs` y candidatos de `/market` en `market_candidates`, con backfill. `PUBLIC_JOBS_LANGUAGE_ENABLED`, `MARKET_CANDIDATES_ENABLED`.
- **C8-16 · `evaluate` cada hora** · PR aparte hacia `main`, **sin integrar** ([#392](https://github.com/Malejo01/job-search-os/pull/392)). Workflow detrás de `vars.EVALUATE_HOURLY`.
- **C8-18 · Textos para Ani** · done ([#394](https://github.com/Malejo01/job-search-os/pull/394)). `/settings/textos` y `docs/beta/textos-para-ani.md`.
- **C8-19 · Voz y tono** · done ([#395](https://github.com/Malejo01/job-search-os/pull/395)).
- **C8-20 · Cierre** · done. Este bloque, la vista previa y el cuerpo de #376.

### Reserva
- **R-1 · Rendimiento** · done ([#400](https://github.com/Malejo01/job-search-os/pull/400)). `pipeline` con `"sideEffects": false`: First Load JS de `/acceso` 161 → 109 kB y de `/jobs` 205 → 156 kB.
- **R-2 · Skeletons** · no se hizo: un `loading.tsx` no puede ir detrás de una variable sin empeorar la navegación.
- **R-3 · Pestañas abajo en el celular** · done ([#399](https://github.com/Malejo01/job-search-os/pull/399)). `MOBILE_TABBAR_ENABLED`.
- **R-4 · `/ayuda` para carreras no tech** · done ([#397](https://github.com/Malejo01/job-search-os/pull/397)).
- **R-5 · Revisión del diff** · done ([#396](https://github.com/Malejo01/job-search-os/pull/396)). Tres bloqueantes arreglados.
- **R-6 · Arquitectura para entrevistas** · done ([#398](https://github.com/Malejo01/job-search-os/pull/398)). `docs/arquitectura-para-entrevistas.md`.

### Pendiente después de la tanda
- **Mauro, antes del merge de #376:** revisar el SQL y aplicar `pnpm db:migrate` (0056 de C6 si falta, 0057, 0058, 0059 y los `rls/` 0006, 0016, 0017, 0018). Las variables apagadas no protegen un despliegue antes de migrar.
- **Mauro, después:** prender las variables en el orden de `docs/beta/tanda-c8.md`; `WAITLIST_EVENT_WINDOW` con el horario real del evento; correr `pnpm pool:backfill-language --remote` (cuenta) y después `--remote --apply`, con `PUBLIC_JOBS_LANGUAGE_ENABLED=1` ya prendida.
- **Firewall de Vercel para `POST /acceso`** (S-2 de la auditoría): regla de rate limit por IP antes del 11/11.
- **Presupuesto de Resend** (S-3 / M-3) antes de prender `WELCOME_EMAIL_ENABLED`.
- **Ani:** `docs/legal/preguntas-ani.md` (incluye `terminos.md:42`, «La beta es gratuita»), `/settings/textos` y `/settings/marca`.
- **Fuentes no tech:** decidir ADR-030 (The Muse); Workable queda sin grabar (necesita red).
- **C8-16:** decidir #392 y `vars.EVALUATE_HOURLY` si la cola de evaluación crece.
- **Pestañas del celular:** antes de prenderlas por defecto, anclar los e2e de 390 px al `nav` correspondiente.

## Bloque 15 — Tanda C9 (rediseño), 2026-11-03 al 04

Una noche de la nube, sin supervisión: el rediseño visual completo de AfinIAJobs (app y páginas públicas) según las 15 decisiones de Mauro del 3/11 (`docs/ux/rediseno-afiniajobs/decisiones-c9.md`). Cada ticket fue un PR `[nube C9]` en draft hacia `ronda/integracion-c9`, mergeado con `--no-ff` con su CI en verde, y **un solo PR de integración** hacia `main` ([#403](https://github.com/Malejo01/job-search-os/pull/403)). Nada se mergeó a `main`; **ninguna migración**; USD 0 de modelos. El rediseño no va detrás de ninguna variable. Mapa de pantallas: `docs/ux/rediseno-afiniajobs/inventario-c9.md`; guía para pantallas nuevas: `guia-rapida.md`.

### Base y cimientos
- **C9-1 · Base** · `estado:` done, 2026-11-03 ([#402](https://github.com/Malejo01/job-search-os/pull/402)). Inventario y decisiones en el repo.
- **C9-2 · Tokens y tipografía** · done ([#404](https://github.com/Malejo01/job-search-os/pull/404), arreglo [#409](https://github.com/Malejo01/job-search-os/pull/409)). Lavanda `#EEEDF9`, tokens de borde inferior, radios 32/24/18/píldora, `edge-4`/`edge-6`/`pressable` en CSS (se hunde 3 px sin mover el layout), Bricolage Grotesque + Figtree.
- **C9-3 · Primitivas** · done ([#405](https://github.com/Malejo01/job-search-os/pull/405)). Button, Card (`flat`/`list`/`featured`), Chip y filtros, Field, Alert, EmptyState, Badge; catálogo en `/settings/marca/componentes` (e2e 114).
- **C9-4 · Logo B2** · done ([#406](https://github.com/Malejo01/job-search-os/pull/406)). Logotipo con el punto, monograma «A», favicon, PNG, OG y emails.

### La firma
- **C9-5 · El sello** · done ([#407](https://github.com/Malejo01/job-search-os/pull/407), e2e [#418](https://github.com/Malejo01/job-search-os/pull/418)). `aria-label` «puntaje 8.5, muy afín» desde R-3. Cinco niveles con su palabra, «Muy afín» inclinado en lima, estado C2, lejanas al final de `/jobs`.
- **C9-6 · Checklist al leer** · done ([#408](https://github.com/Malejo01/job-search-os/pull/408)). Evaluaciones de antes del 21/10: solo la parte determinista, `parcial`, sin IA ni escritura; solo en el detalle.

### Pantallas con sesión
- **C9-7 · Navegación** · done ([#410](https://github.com/Malejo01/job-search-os/pull/410)). Barra índigo con píldoras; en el celular, cinco pestañas abajo siempre (sale `MOBILE_TABBAR_ENABLED` y el «Menú»), «Más» en Perfil.
- **C9-8 · Tarjeta K2** · done ([#411](https://github.com/Malejo01/job-search-os/pull/411)). **C9-9 · Detalle D3 y O3** · done ([#412](https://github.com/Malejo01/job-search-os/pull/412)). **C9-10 · Hoy** · done ([#413](https://github.com/Malejo01/job-search-os/pull/413)). **C9-11 · El resto** · done ([#419](https://github.com/Malejo01/job-search-os/pull/419)).

### Estados, ilustraciones y movimiento
- **C9-12 · Ilustraciones** · done ([#414](https://github.com/Malejo01/job-search-os/pull/414)). Manifiesto con test, `<Illustration>` con marcador; `hoy` (de `assets/ilustraciones-c9`).
- **C9-13 · Estados** · done ([#420](https://github.com/Malejo01/job-search-os/pull/420)). F1, V3 y F2 (el texto no se pierde, e2e 117).
- **C9-14 · Movimiento** · done ([#415](https://github.com/Malejo01/job-search-os/pull/415)). El sello se estampa, el check rebota; nada con «reducir movimiento» (e2e 115).

### Textos, públicas y revisión
- **C9-15 · Textos** · done ([#417](https://github.com/Malejo01/job-search-os/pull/417)). «El cupo es limitado.»; voz en `docs/MARCA.md`.
- **C9-16 · Públicas** · done ([#416](https://github.com/Malejo01/job-search-os/pull/416)). **C9-17 · Revisión** · done ([#421](https://github.com/Malejo01/job-search-os/pull/421)). e2e 116 con capturas como artefacto del CI.
- **C9-18 · Cierre** · done. Este bloque, la vista previa y el cuerpo de #403.

### Reserva
- **R-1 · Rendimiento** · done ([#422](https://github.com/Malejo01/job-search-os/pull/422)). `/hoy` 146 → 138 kB y `/jobs` 156 → 166 kB de First Load JS.
- **R-2 · Esqueletos** · descartado ([#424](https://github.com/Malejo01/job-search-os/pull/424), cerrado): sin JS el esqueleto quedaba para siempre y rompía los atajos del detalle.
- **R-3 · Revisión del diff** · done ([#425](https://github.com/Malejo01/job-search-os/pull/425)). Revisor aparte: cuatro bloqueantes (tres arreglados; el de la ilustración de Hoy sin recuadro lo resuelve la guía de Mauro) y sugerencias aplicadas. **R-4 · Guía rápida** · done ([#423](https://github.com/Malejo01/job-search-os/pull/423)).

### Pendiente después de la tanda
- **Mauro:** mirar la vista previa (los enlaces están en #403), revisar las «Decisiones para Mauro» del cuerpo y mergear #403; el PR toca `.github/workflows/ci.yml` (capturas del e2e), así que va con bypass. Borrar `MOBILE_TABBAR_ENABLED` de Vercel y de `.env.example` (ya no se usa).
- **Ilustraciones:** 7 de 8 escenas siguen con el marcador (todas menos `hoy`). Para sumarlas, `docs/ux/rediseno-afiniajobs/ilustraciones.md`.
- **Ani:** los textos nuevos (tabla en #417) y el catálogo `/settings/marca/componentes`.

## Bloque 16 — Tanda C10 (fidelidad visual), 2026-11-04

La nube rehízo las pantallas mirando las imágenes aprobadas por Mauro el 4/11 (`docs/ux/rediseno-afiniajobs/referencias/`), y no las decisiones en texto. Cada pantalla se compara contra su referencia con el e2e 120, que arma «referencia | real» a 390 y 1280 px con los datos de Lucía (ficticia) y la sube como artefacto «comparaciones» del job e2e. Se hizo en cuatro secciones, cada una en un PR `[nube C10]` hacia `ronda/integracion-c9` mergeado con `--no-ff`; el PR de integración sigue siendo [#403](https://github.com/Malejo01/job-search-os/pull/403). **Ninguna migración**; USD 0 de modelos. Diferencias de C9 contra cada referencia: `docs/ux/rediseno-afiniajobs/c10-brechas.md`.

### Sección 1 · Herramienta
- **C10-1 · Captura contra referencia y datos de prueba** · `estado:` done, 2026-11-04 ([#428](https://github.com/Malejo01/job-search-os/pull/428)). `e2e/c10/lucia.ts` (las 4 ofertas de las referencias con su checklist), e2e 120 y el artefacto «comparaciones» en `ci.yml`.

### Sección 2 · Primitivas y navegación
- **C10-2 · Primitivas exactas** · done ([#429](https://github.com/Malejo01/job-search-os/pull/429)). `.card`/`.cardl`, botones con 5 px abajo (`edge-5`), chips «✓»/«!», filtros de 38 px (área táctil de 44), campos, sello circular con anillo de 2 px en tres tamaños, `CheckMark`, logo con la «A» de trazo. Tokens `line-ink` e `ink-accent`.
- **C10-3 · Navegación** · done (#429). Cinco píldoras y avatar en la barra; pestañas blancas con la activa en una píldora lima; barra pública con Cómo funciona, Precios, Ayuda, Entrar y «Anotarme a la beta». Ajustes, Salir y lo demás, en «Más» de Perfil.

### Sección 3 · Sin sesión
- **C10-4 · Portada** · done ([#430](https://github.com/Malejo01/job-search-os/pull/430)). Coincide con la referencia en 390 y 1280.
- **C10-5 · /acceso** · done (#430). Cabecera curva, tarjeta montada, carreras como chips; lógica de C8 intacta.

### Sección 4 · Con sesión y cierre
- **C10-6 · Hoy** · done (PR de la sección 4). Cabecera curva con el saludo, «Para hacer hoy», «La mejor de hoy» y «También para vos»; lo demás en «Más de tu semana».
- **C10-7 · Ofertas** · done (ídem). «Tus ofertas», chips de filtro (sale el filtro `modalidad=remoto`), lista de 470 px con la tarjeta K2 y el detalle al lado.
- **C10-8 · Detalle D3** · done (ídem). `components/offer-d3.tsx`: el panel de PC y `/jobs/[id]` en el celular, con «Postularme en el sitio del aviso» fijo abajo.
- **C10-9 · Integración y vista previa** · done (ídem). Este bloque, la vista previa y la sección C10 del cuerpo de #403.

### Pendiente después de la tanda
- **Mauro:** mirar las comparaciones (artefacto «comparaciones» del job e2e de #403) y la vista previa, revisar las «Decisiones para Mauro» de cada PR de C10 y mergear #403.
- **Ilustración «acceso»:** sigue el marcador; la referencia la espera (`docs/ux/rediseno-afiniajobs/ilustraciones.md`).

## Bloque 17 — Decisiones del 5/11 en los documentos de la beta

### D5-1 · Alinear `docs/beta/*` con las decisiones del 5/11
`deps:` — · `est:` 1 h · `estado:` done (2026-11-06)
- Cupo de 15 a 20 personas; becas: un becado gratis y dos con 50 % (ya no «3 becadas»); el 11/11 es el evento «Voces Jóvenes» (10 proyectos, sin diapositivas), no una charla; soporte por WhatsApp Business y `contacto@afiniajobs.com.ar`; cobros por una cuenta nueva de Mercado Pago compartida (links `MP_LINK_*` a actualizar); carreras por responsable; dominio `afiniajobs.com.ar` comprado y `afiniajobs.com` como protección.
- Texto canónico: `docs/beta/runbook-apertura.md`, «Decisiones del 5/11». Tocados además `capacidad.md`, `tanda-c8.md`, `preguntas-frecuentes.md`, `textos-para-ani.md`, `voces-jovenes/*`, `OPERACION.md`, `DEPLOY.md` y `legal/preguntas-ani.md`.
- **Acepta:** `grep` de «3 becad», «charla» y «becadas» sin restos que hablen del evento o de las 3 becas. Solo documentación: no se cambió ninguna variable ni código.

### Pendiente después de D5-1
- **[A DEFINIR: combos de Ani]:** los dos combos que paga el resto del cupo, y cómo encajan con el Plan Beta de ARS 20.000.
- **[A CONFIRMAR]:** quién es el becado gratis (se lleva en Notion), si es solo el primer mes o toda la beta, y quién lleva relaciones internacionales.
- **[A CONFIRMAR con Mauro]:** si las dos personas que no pagan son parte de los lugares de becas o van aparte; si programación es una carrera más de la beta (hoy son 6, ADR-027); dónde se muestra el QR en el evento, ya que no hay diapositivas.
- **Mauro:** actualizar los `MP_LINK_*` con la cuenta nueva; crear `contacto@afiniajobs.com.ar`; migrar y redirigir `afiniajobs.com.ar`; comprar `afiniajobs.com`. **Ani:** crear el WhatsApp Business y definir los combos.

## Bloque 18 — Tanda R4 (Antigravity), 2026-11-06

Fuente del estado: `ops/tanda-r4/estado.md`. Los PR de carril rojo se acumulan en #439 y los mergea Mauro.

### R4-01 · Ilustraciones serie E2 sobre la arquitectura de main
`deps:` — · `est:` a confirmar · `estado:` en rama local (sin push)
- Rama `ronda/r4-01-ilustraciones` con 2 commits locales. Reemplaza al #437, que cierra Mauro.
- Sin push: el barrido (pre-push y `pr.mjs`) marca con el patrón #64 los nombres de archivo `@2x` (falso positivo). Es PR rojo propio y lo mergea Mauro. El cuerpo del PR está en `ops/tanda-r4/pr-r4-01-cuerpo.md`.
- **Acepta:** a confirmar.

### R4-02 · Tema claro por defecto + ThemeSync
`deps:` — · `est:` a confirmar · `estado:` done (2026-11-06)
- #441 mergeado por carril verde: tema claro por defecto y el oscuro elegido no se pierde al navegar.
- **Acepta:** `/` y las pantallas públicas sin preferencia guardada salen en claro; elegir oscuro se mantiene en `/mercado`, `/acceso` y `/ayuda`, también al recargar.

### R4-03 · «El cupo es limitado»
`deps:` — · `est:` a confirmar · `estado:` done (2026-11-06)
- #442 mergeado por carril verde: texto de acceso en los docs de la beta.
- **Acepta:** a confirmar.

### R4-04 · Dominio nuevo en los docs
`deps:` — · `est:` a confirmar · `estado:` parcial: docs done (2026-11-06), rojo en PR #439
- #443 mergeado (`afiniajobs.com.ar` como dominio actual en los docs). La parte roja (config) está en #439.
- Falta: `.github/workflows/smoke.yml` (`SMOKE_BASE_URL`) lo edita Mauro (`ops/tanda-r4/pendiente-mauro-smoke-yml.md`); verificar `canonical`, `og:url` y `og:image` de `/` en producción. `robots.txt` y `sitemap.xml` ya verificados.
- **Acepta:** a confirmar.

### R4-05 · Pasos manuales de la tanda
`deps:` — · `est:` a confirmar · `estado:` done (2026-11-06)
- #440 mergeado: `docs/beta/pasos-manuales-r4.md` con los pasos que hace solo Mauro. §12 y §13 se completaron con R4-15 y R4-17 (esta tarea).
- **Acepta:** a confirmar.

### R4-06 · Propuesta de `/applications`
`deps:` — · `est:` a confirmar · `estado:` en PR #445
- Documento de propuesta; se mergea junto con R4-07. Revisor (2.ª vuelta) y privacidad PASA.
- **Acepta:** a confirmar.

### R4-07 · `/applications` agrupada + inactividad
`deps:` R4-06 · `est:` a confirmar · `estado:` en PR #446
- Revisor y privacidad PASA. Falla un e2e en el CI (`37`: el locator filtra por un botón dentro de un `details` cerrado); arreglo pendiente: filtrar por `input[name="applicationId"]`.
- **Acepta:** a confirmar.

### R4-08 · Auditoría
`deps:` — · `est:` a confirmar · `estado:` en PR #447
- Documento con 35 hallazgos (3 altos, 9 medios, 23 bajos). 10 tareas «[Auditoría R4]» en Notion.
- **Acepta:** a confirmar.

### R4-09 · Arreglos chicos
`deps:` a confirmar (sale de los hallazgos de R4-08) · `est:` a confirmar · `estado:` en PR #448 (textos) y #449 (estados, móvil y foco)
- Textos: /demo y modalidad revertidos tras la revisión, con la excepción declarada. Excluidos por tener PR abierto: hallazgos 17, 25 y 32; a Notion: 10, 13 y 33; el 4 es rojo (legal).
- **Acepta:** a confirmar.

### R4-10 · Tarea que depende de Ani
`deps:` Ani · `est:` a confirmar · `estado:` bloqueado (depende de Ani)

### R4-11 · Combos de Ani y cuenta de Mercado Pago
`deps:` Ani, cuenta de Mercado Pago · `est:` a confirmar · `estado:` bloqueado (combos de Ani y cuenta de Mercado Pago)

### R4-12 · ADR-031
`deps:` — · `est:` a confirmar · `estado:` en PR #439
- La línea de la regla 5 de `CLAUDE.md` la aplica Mauro (`ops/tanda-r4/pendiente-mauro-claude-md.md`).
- **Acepta:** a confirmar.

### R4-13 · PR rojo acumulador
`deps:` a confirmar (junta lo rojo de R4-04, R4-12, R4-15, R4-16 y R4-17) · `est:` a confirmar · `estado:` en PR #439, listo para Mauro
- Traer `origin/main` con `git merge` no es posible para los agentes; si aparecen conflictos, los resuelve Mauro.
- Un solo push al final por el costo del job `evals` (~USD 0,15 por corrida, tope USD 0,5), con OK de Mauro.

### R4-14 · Este backlog
`deps:` — · `est:` a confirmar · `estado:` en esta rama (`ronda/r4-14-backlog`)
- Bloque 18, `docs/beta/pasos-manuales-r4.md` §12 y §13, y los docs de costos (`LLM_COSTOS.md`, `costos-por-usuario.md`, ADR-026) con la reserva y el prompt v2 de R4-16.

### R4-15 · Asistente para testers, mascota y chip
`deps:` — · `est:` a confirmar · `estado:` en PR #444 (verde) y #439 (rojo)
- `ASSISTANT_ENABLED=testers` habilita a `ADMIN_EMAILS` más `ASSISTANT_TESTER_EMAILS`; ser tester no da admin. Mascota abajo a la derecha y chip «¿Algo no anduvo?».
- Orden: mergear #444 antes que #439.
- **Acepta:** a confirmar.

### R4-16 · Repreguntas del chat de CV
`deps:` — · `est:` a confirmar · `estado:` en PR #439
- Prompt `cv_interview@v2`; `CV_CHAT_TURN_RESERVE_USD` de 0,025 a 0,03. Tono provisorio.
- **Acepta:** a confirmar.

### R4-17 · Prompts del asistente + fila `assistant_chat`
`deps:` a confirmar · `est:` a confirmar · `estado:` en PR #439
- Prompts del asistente y fila `assistant_chat` en `packages/db/seeds/model_routing.json`. Tono provisorio. La fila en Neon la aplica Mauro (`docs/beta/pasos-manuales-r4.md` §13).
- **Acepta:** a confirmar.

### Pendiente después de la tanda
- **Mauro:** pushear o resolver R4-01 (patrón #64 del barrido) y cerrar el #437; mergear #444, #445 con #446, #447, #448, #449 y, al final, el PR rojo #439; editar `smoke.yml` y la regla 5 de `CLAUDE.md`; aplicar la fila `assistant_chat` y cargar las variables del asistente; revisar la pausa de auto-merge (smoke de #442 cancelado por timeout).
- **Sin resolver:** R4-10 y R4-11 (Ani y cuenta de Mercado Pago); tono definitivo de R4-16 y R4-17; las 10 tareas «[Auditoría R4]» de Notion; medir el costo real del chat de CV con `pnpm llm:spend`.

## Bloque 19 · Tanda R5 (10/11)

### C1 · Textos públicos y /acceso a 8 carreras
`deps:` — · `est:` 1 h · `estado:` done, mergeado ([#454](https://github.com/Malejo01/job-search-os/pull/454), 12/11)
- Portada, /acceso (titular, bajada, chips y texto de «Pasáselo a alguien»), /ayuda y /como-esta-hecho pasan de 6 a 8 carreras: abogacía, contaduría, administración, comunicación, marketing, relaciones públicas, relaciones internacionales y programación. «Marketing y RR.PP.» pasa a ser «Marketing».
- Los chips de Relaciones públicas y Programación guardan una carrera que ya existe hasta C3 (carril rojo): `marketing_digital` y `fullstack`. `BETA_LAUNCH_ROLE_KEYS` y el grupo «Carreras de la beta» del selector no cambian (eso es pipeline, C3).
- e2e 44 (los 8 chips y la carrera que guarda cada uno) y 96 (la lista de /ayuda); guion del reel en `docs/beta/voces-jovenes/guion-demo.md`.
- **Acepta:** /acceso muestra 8 chips; elegir Relaciones públicas envía `marketing_digital` y Programación envía `fullstack`.

### C3 · Las 8 carreras en el pipeline (carril rojo)
`deps:` C1 · `est:` 3 h · `estado:` en PR, para que lo revise Mauro ([#457](https://github.com/Malejo01/job-search-os/pull/457), 12/11; ⚠️ migración 0061 sin aplicar)
- `relaciones_publicas` carrera propia (ADR-033): títulos, chips, skills, prefiltro (con los cargos de redes, marca y eventos que también son de RR.PP.), veto del pool y casilla `pool-relaciones_publicas`; marketing deja de cubrir RR.PP.; `BETA_LAUNCH_ROLE_KEYS` con las 8 (suma `fullstack`); el chip de /acceso guarda `relaciones_publicas`; `waitlist_role_check` (0061) y `rls/0012` suman la clave.
- **Acepta:** elegir RR.PP. en /acceso envía `relaciones_publicas` (e2e 44); el selector lista las 8; una persona de RR.PP. tiene catálogo y prefiltro propios (tests de pipeline).

### C5 · Legales sin el precio contradictorio (carril rojo)
`deps:` respuestas legales 1, 2, 3 y 6 de Mauro · `estado:` bloqueada (12/11)
- Quitar el precio contradictorio de los legales, completar los marcadores que esas respuestas permitan y que `pnpm legal:check` pase.

### C6 · Estados de carga
`deps:` — · `est:` 1,5 h · `estado:` en PR, para que lo revise Mauro ([#456](https://github.com/Malejo01/job-search-os/pull/456), 12/11)
- `loading.tsx` en 13 rutas de la app con esqueletos nuevos (`components/ui/skeleton.tsx`), Server Components, pulso solo con `motion-safe`; e2e 125 (red lenta, sin saltos de layout, reducir movimiento).
- Después de mergear C6 y C9: ajustar 4 `loading.tsx` (Hoy, Ofertas, Perfil, Skills) a los anchos nuevos de C9.

### C7 · /demo alineado y textos de pre-puntaje
`deps:` — · `est:` 1 h · `estado:` en PR, para que lo revise Mauro ([#455](https://github.com/Malejo01/job-search-os/pull/455), 12/11)
- /demo muestra un solo perfil (contaduría), coherente con /demo/contaduria y el guion; el ajuste «se asume 5 0» pasa a una frase en llano (hallazgo 28). e2e 48 y 103.

### C8 · Las 8 carreras primero en catálogos y selectores (carril rojo por C3)
`deps:` C3 · `est:` 2 h · `estado:` en PR, para que lo revise Mauro ([#461](https://github.com/Malejo01/job-search-os/pull/461), apilado sobre #457, 12/11)
- Grupo «Carreras de la beta» primero y el resto bajo «Otras carreras» en selectores de puestos, Skills y /market; las 8 primero en los chips de /mercado y /ofertas; nombres de beta (`lib/career-names.ts`); «Skills sugeridas» (hallazgos 6, 21 y 35). e2e 128.

### C9 · Perfil, anchos, «Primeros pasos» y glosario
`deps:` — · `est:` 2 h · `estado:` en PR, para que lo revise Mauro ([#458](https://github.com/Malejo01/job-search-os/pull/458), 12/11)
- «Sin descripción» marca Ofertas y se enlaza desde /jobs; /encaje marca Perfil; dos anchos (lista 1280 px, lectura `max-w-3xl`); Primeros pasos plegado; glosario en /ayuda y en «Más» (hallazgos 18, 19, 20, 30 y 33). e2e 38, 113 y 127.

### C10 · Docs de la beta a 8 carreras
`deps:` C3, C8 (para la descripción del selector) · `est:` 1 h · `estado:` en PR, para que lo revise Mauro ([#459](https://github.com/Malejo01/job-search-os/pull/459), 12/11)
- Guía del ensayo con testers, preguntas frecuentes, runbook, checklist del evento, textos para Ani, personas e2e y fuentes: 8 carreras con su nombre de beta. Las menciones históricas quedan como están.

### C11 · Costos por usuario contra el código
`deps:` — · `est:` 2 h · `estado:` en PR, para que lo revise Mauro ([#460](https://github.com/Malejo01/job-search-os/pull/460), 12/11)
- `docs/beta/costos-por-usuario.md` recalculado con `evaluate_job` en Sonnet 5.5 (thinking `low`, `max_tokens` 8192): tres escenarios de thinking, 10 / 25 / 50 usuarios en USD y ARS, y los 11 puntos de `pasos-manuales-r4` §9 respondidos con el código o marcados «a confirmar por Mauro».
- Aparte, `model_routing.json` alineado con producción (carril rojo): commit local en `ronda/r5-c11-routing`, **sin push**, porque toca `evals/` y cada push corre el job de evals pago. Espera la decisión de Mauro.

### C12 · QA por carrera con agentes de prueba
`deps:` C3 (parte 2) · `est:` 3 h · `estado:` en PR, para que lo revise Mauro ([#462](https://github.com/Malejo01/job-search-os/pull/462), 12/11)
- 8 personas ficticias, spec 126 (recorrido con capturas a 390 y 1280 px), 12 avisos inventados de RR.PP. y programación, test de prefiltro de las 8 carreras e informes en `docs/beta/qa-carreras/` con hallazgos P0/P1/P2. Parte 2 sobre C3+C8 en una rama local sin push.

### C13 · Cierre de la tanda
`deps:` todo en PR · `estado:` en PR, para que lo revise Mauro (12/11)
- Este bloque al día y `docs/beta/informe-r5.md` (orden de merge, pruebas, migraciones sin aplicar, pasos manuales y hallazgos de QA).
