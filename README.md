# Job Search OS

Sistema de gestión de búsqueda laboral para perfiles IT: ingesta multi-fuente, deduplicación, prefiltro determinista, evaluación con LLM contra un perfil verificable, human-in-the-loop para la lectura de JDs, inteligencia de mercado y plan de formación priorizado por demanda real.

**Tesis:** el modelo evalúa, el código decide, el humano interviene solo donde hace falta. Menos postulaciones, mejores, y sabés qué estudiar.

## Qué hace hoy (estado al 2026-09-11)

```
Get on Board (API) ──┐                          ┌─ /jobs · /jobs/[id] · /jobs/pending-jd · /jobs/new
Alta manual (UI/MCP) ┼─► dedup ─► prefiltro ─► cola ─► worker LLM ─► decide() ─► ┼─ /market · /plan
Email (bloque 4) ····┘      (14 días)  (reglas)         (o modo demo/offline)     └─ MCP: /api/mcp (7 tools)
```

- **Ingesta**: Get on Board por API pública cada 6 h (GitHub Actions → `/api/cron/*`), alta manual desde la UI o desde Claude vía MCP. Email entrante (Resend) es el bloque 4, en curso.
- **Pipeline puro** (`packages/pipeline`, sin I/O, 190 tests): normalización, dedup por URL / empresa+título / similitud de JD, prefiltro por reglas del perfil, `decide()` (cap de título, penalizaciones verificables, tabla de acción), máquina de estados de la oferta, skills por alias determinista, agenda de mercado, plan de formación y pre-score offline.
- **Evaluador LLM**: Vercel AI SDK con ruteo por tabla `model_routing` (Gemini 3.5 Flash con `thinking_level: minimal`, fallback Claude Haiku 4.5), prompts versionados en Markdown, salida JSON validada con Zod. Harness de evals contra un golden set de 34 ofertas reales con métricas de aceptación (MAE, recall de bloqueadores, precisión de riesgos).
- **Modo offline**: si no hay créditos, cada oferta muestra igual un pre-score determinista (skills de la JD × tu nivel, riesgos del prefiltro, salario), marcado como "pre". Modo demo del worker (`--demo`) para ver el flujo entero sin LLM.
- **Guardarraíles de costo**: tarifas reales por modelo, `llm_calls` con tokens de thinking, estimación antes de cada corrida de evals, tope diario del worker, timeouts y cancelación limpia. Motivo y números en `docs/LLM_COSTOS.md`.
- **Multi-tenant desde el día 1**: RLS con `FORCE` en todas las tablas de usuario, rol de la app sin `BYPASSRLS` verificado al arrancar, `SET LOCAL app.user_id` por request. Auth.js con email + contraseña.
- **Inteligencia sin LLM**: `/market` (demanda ponderada por skill vs. tu nivel: gaps, diferenciales), `/plan` (prioridad = demanda × (1 − nivel/3) × facilidad, con recursos de un catálogo manual).
- **Operación desde el chat**: servidor MCP propio (`list_jobs`, `get_job`, `set_status`, `paste_jd`, `add_job`, `market_summary`, `list_pending_jd`) para usar desde Claude en el celular.

Lo que el sistema **no** hace por diseño (ADR-004): navegar LinkedIn ni postular por vos.

## Stack

Next.js 15 (App Router, Server Components y Server Actions) · TypeScript strict · Tailwind 4 · Framer Motion · Drizzle + Postgres en Neon (pgvector) · Vercel AI SDK (Gemini, Anthropic) · Zod · Vitest + Testcontainers · Playwright · pnpm + Turborepo · GitHub Actions · MCP (`mcp-handler`).

## Correr local

```bash
pnpm install
pnpm db:up                 # Postgres 16 + pgvector en Docker (:54322)
pnpm db:migrate:local && SEED_USER_EMAIL=vos@mail SEED_USER_PASSWORD=algo-largo pnpm db:seed:local
pnpm --filter @job-search-os/web dev   # http://localhost:3000, apunta a Docker
```

Sin key de Gemini el sistema funciona igual: `pnpm worker:evaluate --local --demo` evalúa con el modelo falso, y la UI muestra pre-scores deterministas. Con key: `pnpm evals run --prompt evaluate_job@v1.1 --subset --runs 1` mide el prompt contra el golden (muestra el costo estimado antes de la primera llamada).

## Dataset de ejemplo y datos privados

El repo es público y trae un **dataset de ejemplo**, a propósito: el golden de 34 ofertas reales con las empresas anonimizadas (Empresa A…AB, la misma letra para la misma empresa, así los pares de dedup y las expectativas del prefiltro siguen valiendo), un perfil, unos criterios y unos niveles de skills genéricos (`packages/db/seeds/*.example.json`). Los casos de frontera que calibran el evaluador (disciplina, ubicación, modalidad, títulos, duplicados) son los originales; lo que no está es la situación laboral del autor (piso salarial, idioma, años, autorización, estados de postulación, contactos). Es una decisión de diseño, no un repo incompleto.

Los datos reales van en `fixtures-private/` (ignorado por git) con el mismo formato: `golden.json`, `profile.json`, `criteria.json`, `skill_levels.json` y `reports/`. Si existen, `pnpm db:seed` y `pnpm evals run` los usan; si no, caen al ejemplo. `loadFixture()` en `packages/db/src/fixtures.ts` es el único punto de decisión, y el seed imprime cuál usó.

Otros comandos: `pnpm ingest:getonboard --local`, `pnpm market:snapshot --local`, `pnpm plan:build --local`, `pnpm skills:extract --local`, `pnpm llm:spend --local`, `pnpm e2e`. Variables en `.env.example`.

## Calidad

`pnpm lint && pnpm typecheck && pnpm test` en cada PR, más integración con Postgres real y Playwright (4 flujos: login y lista, pegar JD → evaluación, cambiar estado, postular → resultado). Tests primero en `packages/pipeline`. Detalle en `docs/TESTING_STRATEGY.md`.

## Estado del backlog

| Bloque | Estado |
|---|---|
| 1 · Fundaciones (JS-001–007) | ✅ |
| 2 · Pipeline: dedup, prefiltro, decide, ingesta GoB, cola y worker (JS-008–013) | ✅ |
| 3 · UI: auth, lista, detalle, cola de JD (JS-014–017) | ✅ |
| CI, deploy, cron (JS-018, JS-019) | ✅ CI y cron en Actions · 🟡 proyecto Vercel pendiente (checklist en `docs/DEPLOY.md`) |
| 4 · Email entrante (JS-020–023) | ✅ JS-023 alta manual · ✅ JS-020 webhook Resend firmado, storage y cola manual (falta DNS + secrets) · ⏳ JS-021/022 parsers (necesitan emails reales) |
| 5 · Inteligencia | ✅ JS-034 plan, JS-035 MCP, JS-036 feedback loop (`/applications`), adelantos de JS-030/031 sin LLM · ⏳ JS-032/033 perfil verificable y entrevista dirigida |
| Calibración del evaluador | ✅ cerrada 2026-09-11: prompt `evaluate_job@v1.3.1`, `gemini-3.1-flash-lite` primario (fallback 3.5-flash), USD 0,0013 por evaluación; números en `docs/LLM_COSTOS.md`, ADR-011. Lo que sigue se calibra con `/applications` (JS-036) |

Deuda registrada (en `docs/BACKLOG.md`): FK `profiles.user_id → users.id` diferida; `ANTHROPIC_API_KEY` sin probar en vivo; niveles de skills autodeclarados hasta la entrevista dirigida; métrica de costo del PRD a ajustar con el costo real.

## Índice de documentación

| Doc | Qué contiene | Leer cuando |
|---|---|---|
| [docs/PRD.md](docs/PRD.md) | Producto, usuario, alcance, no-alcance, métricas | Siempre, primero |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Monorepo, capas, flujo de datos, adapters | Antes de tocar estructura |
| [docs/adr/](docs/adr/) | Decisiones de arquitectura con alternativas (Neon, Auth.js, sin scraping, costos) | Antes de cuestionar una decisión |
| [docs/SCHEMA.md](docs/SCHEMA.md) + [packages/db/schema.ts](packages/db/schema.ts) | Modelo de datos completo (Drizzle) | Antes de cualquier migración |
| [docs/LLM_COSTOS.md](docs/LLM_COSTOS.md) | Qué costó, por qué, tarifas, guardarraíles, proyección mensual | Antes de correr algo con LLM |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Checklist de deploy, variables, cron en Actions, cómo conectar el MCP | Al desplegar |
| [docs/USO_DIARIO.md](docs/USO_DIARIO.md) | El día típico: qué pantallas mirar, qué comandos correr, qué corre solo, qué hacer cuando falla | Cada día de búsqueda |
| [docs/AUDITORIA_2026-09-11.md](docs/AUDITORIA_2026-09-11.md) | Qué quedó a medias, tests débiles, decisiones sin ADR, deudas urgentes, priorizado | Antes del deploy y al planificar |
| [docs/EVALUATOR_PROMPT_v1.md](docs/EVALUATOR_PROMPT_v1.md) + [packages/prompts/](packages/prompts/) | Prompt del evaluador (v1 → v1.3.1; producción v1.3.1), criterios, JSON de salida | Al tocar scoring |
| [evals/](evals/) | Golden dataset de ejemplo (34 ofertas reales anonimizadas) y harness | Al cambiar prompt o modelo |
| [docs/TESTING_STRATEGY.md](docs/TESTING_STRATEGY.md) | Pirámide de tests, qué se testea y cómo | Antes de escribir código |
| [docs/AWS_MIGRATION_PLAN.md](docs/AWS_MIGRATION_PLAN.md) | Cómo pasa de Vercel+Neon a AWS sin reescribir | Fase 3 |
| [docs/sources/](docs/sources/) | Hallazgos por fuente de ingesta (API de Get on Board) | Antes de tocar un adapter de fuente |
| [docs/BACKLOG.md](docs/BACKLOG.md) | Tickets numerados con dependencias, criterios de aceptación, estados y deudas | Cada sesión de trabajo |
| [CLAUDE.md](CLAUDE.md) | Reglas para agentes de código | Automático |
| [docs/CLAUDE_CODE_PLAYBOOK.md](docs/CLAUDE_CODE_PLAYBOOK.md) | Prompts por bloque para ejecutar el backlog con Claude Code | Al abrir cada sesión |
