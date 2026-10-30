# Desarrollo: correr, comandos y mapa de documentos

Esta guía conserva lo que antes estaba en el README y es útil para quien toca el código. La presentación del proyecto está en el [README](../README.md). Las reglas para agentes de código están en [CLAUDE.md](../CLAUDE.md).

## Correr local

Requisitos: Node 22 o superior, pnpm y Docker Desktop (Postgres 16 con pgvector).

```bash
pnpm install
pnpm db:up                 # Postgres 16 + pgvector en Docker (:54322)
pnpm db:migrate:local && SEED_USER_EMAIL=vos@mail SEED_USER_PASSWORD=algo-largo pnpm db:seed:local
pnpm --filter @job-search-os/web dev   # http://localhost:3000, apunta a Docker
```

Importante: usá siempre las variantes `:local` (`pnpm db:migrate:local`, `pnpm db:seed:local`). `pnpm db:migrate` sin `--local` apunta a la base remota de producción y pide confirmación explícita; `pnpm db:seed` reescribe perfil y golden y no se corre contra producción.

Sin key de Gemini el sistema funciona igual: `pnpm worker:evaluate --local --demo` evalúa con el modelo falso y la UI muestra pre-scores deterministas. Con key, `pnpm evals run --prompt evaluate_job@<versión> --subset --runs 1` mide el prompt contra el golden y muestra el costo estimado antes de la primera llamada (es una corrida paga: ver [LLM_COSTOS.md](LLM_COSTOS.md)).

## Otros comandos

`pnpm ingest:getonboard --local`, `pnpm market:snapshot --local`, `pnpm plan:build --local`, `pnpm skills:extract --local`, `pnpm llm:spend --local`, `pnpm e2e`, `pnpm test:integration`. Las variables están en `.env.example`.

Antes de abrir un PR: `pnpm lint && pnpm typecheck && pnpm test`. Los tests de integración y los e2e necesitan Docker abierto.

## Dataset de ejemplo y datos privados

El repo es público y trae un **dataset de ejemplo**, a propósito: un golden de 37 ofertas con las empresas anonimizadas (Empresa A, B, C…; la misma letra para la misma empresa, así los pares de dedup y las expectativas del prefiltro siguen valiendo), más 4 avisos adversariales inventados, un perfil, unos criterios y unos niveles de skills genéricos (`packages/db/seeds/*.example.json`). Los casos de frontera que calibran el evaluador (disciplina, ubicación, modalidad, títulos, duplicados) se conservan; la situación laboral real del autor no está. Es una decisión de diseño, no un repo incompleto.

Los datos reales van en `fixtures-private/` (ignorado por git) con el mismo formato. Si existen, `pnpm db:seed` y `pnpm evals run` los usan; si no, caen al ejemplo. `loadFixture()` en `packages/db/src/fixtures.ts` es el único punto de decisión.

## Índice de documentación

| Doc | Qué contiene | Leer cuando |
|---|---|---|
| [PRD.md](PRD.md) | Producto, usuario, alcance, no-alcance, métricas | Siempre, primero |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Monorepo, capas, flujo de datos, adapters | Antes de tocar estructura |
| [adr/](adr/) | Decisiones de arquitectura con alternativas | Antes de cuestionar una decisión |
| [SCHEMA.md](SCHEMA.md) y [packages/db/schema.ts](../packages/db/schema.ts) | Modelo de datos (Drizzle) | Antes de cualquier migración |
| [LLM_COSTOS.md](LLM_COSTOS.md) | Qué costó, tarifas, guardarraíles | Antes de correr algo con LLM |
| [DEPLOY.md](DEPLOY.md) | Deploy, variables, cron, conexión del MCP | Al desplegar |
| [OPERACION.md](OPERACION.md) | Operación y smoke post-deploy | Al operar producción |
| [CARRIL_VERDE.md](CARRIL_VERDE.md) | Merge automático con barreras | Al abrir un PR |
| [USO_DIARIO.md](USO_DIARIO.md) | El día típico de uso | Cada día de búsqueda |
| [AUDITORIA_2026-09-11.md](AUDITORIA_2026-09-11.md) | Qué quedó a medias, deudas, priorizado | Al planificar |
| [EVALUATOR_PROMPT_v1.md](EVALUATOR_PROMPT_v1.md) y [packages/prompts/](../packages/prompts/) | Prompt del evaluador y criterios | Al tocar scoring |
| [evals/README.md](../evals/README.md) | Harness de evals y métricas | Al cambiar prompt o modelo |
| [TESTING_STRATEGY.md](TESTING_STRATEGY.md) | Pirámide de tests | Antes de escribir código |
| [AWS_MIGRATION_PLAN.md](AWS_MIGRATION_PLAN.md) | Cómo pasaría de Vercel y Neon a AWS | Fase 3 |
| [sources/](sources/) | Hallazgos por fuente de ingesta | Antes de tocar un adapter |
| [BACKLOG.md](BACKLOG.md) | Tickets, dependencias, estados y deudas | Cada sesión de trabajo |
| [CLAUDE_CODE_PLAYBOOK.md](CLAUDE_CODE_PLAYBOOK.md) | Prompts por bloque para Claude Code | Al abrir cada sesión |
