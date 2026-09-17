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

### JS-020 · Inbound email (Resend)
`deps:` JS-019 · `est:` 2 h
- **Hecho 2026-09-11 (infra, sin parsers):** `POST /api/inbound` con verificación Svix obligatoria (`verifySvix`, sin dependencia; 401 sin firma), evento `email.received`, cuerpo vía `GET /emails/receiving/{id}` con `RESEND_API_KEY`, crudo en `raw_blobs` (adapter `storage` sobre Postgres, RLS), fila en `inbound_emails`, despacho por remitente (`chooseParserName`: linkedin | getonboard | generic), idempotencia por `email_id`, rate limit 100/hora por usuario. Sin parser o estructura no reconocida → cola manual (`/inbox`, link a `/jobs/new`). Tests: unit (firma) + integración (storage, fila, duplicado, destinatario desconocido, rate limit). Pasos de configuración en `docs/DEPLOY.md`.
- **Investigación 2026-09-11 (antes de escribir código):** el plan Free de Resend incluye recepción ("All plans include: … inbound emails"; 3.000 emails/mes, 100/día, 3 dominios, retención 30 días); funciona con registros MX en un subdominio (`ingest.<tu-dominio>`) y un webhook firmado (Svix) que avisa `email.received`; el cuerpo se pide por API. Alternativa: Cloudflare Email Routing + Email Worker (gratis, 25 MiB por mensaje, 200 reglas; el Worker recibe el MIME crudo y puede hacer `fetch` al webhook propio, con límites de CPU del plan Free; requiere el DNS del dominio en Cloudflare). Decisión pendiente de Mauro.
- Dominio `ingest.<dominio>`, webhook `POST /api/inbound` con verificación de firma, guarda crudo en storage, fila en `inbound_emails`, despacha por remitente.
### JS-021 · Parser LinkedIn ✅ done 2026-09-17
`deps:` JS-020 · `est:` 2 h
- `inbound/linkedin.ts`: las alertas de empleo traen un aviso por tarjeta `data-test-id="job-card"`, con el id en `/jobs/view/<id>/` y la línea "Empresa · Ubicación (Modalidad)". Extrae título, empresa, ubicación, modalidad, badges (lista blanca: lo que no reconoce lo ignora, así el pie del email no entra) y URL canónica. `countriesAllowed` queda **null** (la alerta no dice desde qué países se contrata) para que el prefiltro marque riesgo de ubicación; `jdText` null → pendiente_jd.
- **Aptitudes y candidatos no están en las alertas**: no se inventan, quedan null. Vienen en otros formatos de email de LinkedIn (JS-022 o después).
- **Falla cerrado, email entero**: sin HTML, sin tarjetas o con una tarjeta que no se entiende → `{ ok: false }` y a la cola manual. No hay extracción parcial.
- Fixtures anonimizadas en `inbound/fixtures/linkedin/` (5 alertas reales + 2 negativos), solo el fragmento del aviso: sin nombre, email, titular del perfil ni tokens de tracking; empresas y títulos ficticios. Los `.eml` crudos quedan en `fixtures-private/email/`. `.prettierignore` las excluye para que el formateo no altere lo que prueban.
- **Acepta:** 28 tests unitarios sobre 10 fixtures (8 alertas con 17 avisos + 2 negativos), **cobertura 100 %** de `linkedin.ts` en líneas, sentencias, funciones y ramas (`pnpm --filter @job-search-os/adapters test:coverage`). Validado contra los 16 emails reales: 17 de 17 avisos extraídos con campos correctos. Flujo real probado de punta a punta con un `.eml` original contra la base local (`handleInboundEmail`, el mismo código del webhook): la oferta queda en `pendiente_jd` con título, empresa, ubicación, modalidad, badges y URL canónica correctos.
- **Ojo con la ubicación de las alertas:** LinkedIn muestra la zona de búsqueda del usuario ("Argentina", "Salta"), no los países desde los que contrata el aviso. Por eso `countriesAllowed` queda null y la decisión real se toma al evaluar con la JD pegada; no confiar en `locationRaw` como si fuera el país del puesto.
- **Gaps conocidos (otros formatos de email de LinkedIn, hoy en cola manual):**
  - *Recomendaciones* ("Amplía tu búsqueda", `jobs-noreply@`): mismas tarjetas pero bajo `JOBS_POSTING_SECTION-job-cards`; trae avisos nuevos y casos de modalidad Híbrido. **Barato de cubrir, recomendado.** Pendiente de decisión de Mauro.
  - *Empleos guardados* ("Solicita tus empleos guardados"): anclas `featured-saved-job` / `other-saved-jobs-job-card-N`, varias tarjetas sin modalidad. Son avisos que el usuario ya guardó, así que entrarían casi todos como duplicado: **se deja como gap**.
### JS-022 · Parser Get on Board (email) y genérico
`deps:` JS-020 · `est:` 1.5 h
### JS-023 · Ingesta manual (URL + texto) ✅ done 2026-09-11
`deps:` JS-017 · `est:` 1 h
- `/jobs/new` (formulario, Server Action) y tool MCP `add_job`: mismo `ingestRawJob` que las fuentes automáticas (dedup 14 días por URL o empresa+título, prefiltro, cola si trae JD; sin JD queda en pendientes de JD), fuente `manual`, bajo RLS (policy `companies_insert` para crear la empresa). Probado: alta por UI (pendiente de JD) y por MCP (insert y luego merge por URL).

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
