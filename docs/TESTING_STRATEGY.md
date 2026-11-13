# Estrategia de testing

Objetivo doble: confiabilidad del sistema y evidencia verificable de "testing automatizado", "evals de LLM", "CI/CD" y "Docker" para el perfil de Mauro.

## Pirámide

| Capa | Herramienta | Qué cubre | Dónde corre |
|---|---|---|---|
| Unit | Vitest | `packages/pipeline`: dedup, prefilter, decide, normalización de títulos/empresas/skills, máquina de estados | cada PR, < 10 s |
| Contract | Vitest + fixtures | Parsers de email (LinkedIn, GoB, genérico) contra HTML real guardado en `fixtures/emails/` (anonimizado); adapter GoB contra respuestas JSON grabadas | cada PR |
| Integration | Vitest + Testcontainers (Postgres 16 + pgvector) | Migraciones, RLS (user A no ve datos de user B), pipeline completo con LLM mockeado | cada PR, ~1 min |
| Evals | harness propio | Prompt × modelo vs golden set | PR que toca prompts/evals; manual antes de cambiar `model_routing` |
| E2E | Playwright | 4 flujos: login → lista con filtros; pegar JD → evaluación aparece; cambiar estado → persiste; postular → resultado (feedback loop). `apps/web/e2e/`, viewport 390 px, worker en modo demo (`--demo`, sin LLM). Local: `pnpm e2e:local:prepare` y `pnpm e2e:local [specs]` (ver «e2e local reproducible»); CI: job `e2e` con Postgres + `next start` | cada PR hacia `main` (job `e2e`; no corre en push a `main` ni en PRs entre ramas) |
| Smoke prod | script | `GET /api/health` (DB, LLM provider, inbound) tras deploy | post-deploy |

## Reglas

1. Todo lo que está en `packages/pipeline` es función pura y tiene test. Sin excepción. Es lo que hace testeable el proyecto sin infraestructura.
2. Un bug encontrado en producción genera primero un test que lo reproduce (fixture), después el fix.
3. El LLM nunca se llama en tests unitarios ni de integración: `adapters/llm` tiene `FakeLlm` que devuelve respuestas grabadas por `task`.
4. Los fixtures de email se anonimizan (empresa y URLs reales pueden quedar; nada del usuario).
5. Los parsers fallan cerrado: si no reconocen la estructura, el email va a `inbound_emails.parser = 'none'` y a una cola manual; nunca se inventan campos.

## Tests obligatorios del golden set (Vitest)

```ts
describe("prefilter", () => {
  it.each(golden.prefilter_expectations.must_discard)("descarta id %i sin LLM", ...)
  it.each(golden.prefilter_expectations.must_pass)("deja pasar id %i", ...)
  it("aplica cap 5 a Empresa L Lead (id 13) por ≤5 candidatos y ai_engineer", ...)
  it("descarta por badge de aptitudes < 40% (ids 18, 31)", ...)
})
describe("dedup", () => {
  it.each(golden.dedup_pairs)("par $a/$b → $expected", ...)
})
describe("decide", () => {
  it("score 7 con bloqueador duro → descartar", ...)
  it("score 5.5 sin bloqueador → guardar", ...)
  it("location_ok=no → bloqueador", ...)
})
```

## CI (GitHub Actions)

```
ci.yml
  lint-typecheck  → pnpm lint && pnpm typecheck
  unit-contract   → pnpm test
  integration     → services: postgres (pgvector/pgvector:pg16) → pnpm test:integration
  build           → next build sin base ni claves (SKIP_APP_ROLE_CHECK=1)
  secrets         → gitleaks sobre toda la historia (falla si encuentra algo; sin allowlists)
  e2e             → Postgres + migrate + seed (usuario con contraseña de CI) + next start + Playwright (4 flujos, worker demo); traces como artifact si falla
  evals           → if: paths prompts/** evals/** → subset de 14 llamadas con tope de costo; sin secret GEMINI_API_KEY se saltea con aviso (nunca falla el build)
  build           → pnpm build
```

Deploy a Vercel: preview solo a pedido (`[preview]` en el mensaje del último commit), producción en merge a `main` si cambió algo que afecta a la web (`scripts/vercel-ignore.sh`, enganchado desde `apps/web/vercel.json`). La verificación de cada PR la hace GitHub Actions, no Vercel. Migraciones: `drizzle-kit migrate` como paso previo al deploy, con `DATABASE_URL` de producción en secret.

## e2e local reproducible (R8-3)

Con Docker abierto (`pnpm db:up`, contenedor `jso-postgres`), desde una base vacía:

```
pnpm e2e:local:prepare     # migra y siembra la base local con datos de EJEMPLO y el usuario de e2e
pnpm e2e:local 20 126      # corre solo los specs 20 y 126 (sin números, corre todos)
```

Ambos pasan por `scripts/e2e-local.mjs`, que fija las variables **adentro** (no hace falta ninguna delante del comando):

- `DB_TARGET=local`, `LLM_DEMO=1` y las URLs locales explícitas, así que un `.env.local` no puede redirigir la base.
- `SEED_FIXTURES=example`: el seed ignora `fixtures-private/` y usa los archivos de ejemplo. Usuario de e2e `mauro@job-search-os.local` (ficticio, el mismo del CI), admin para los casos que lo piden.
- **Falla cerrado:** si en el entorno hay una variable de base (`DATABASE*`, `PGHOST`, `*_URL` o un valor `postgres://`) que no sea localhost, el script corta antes de lanzar nada. Neon no es alcanzable por este camino.
- Los filtros solo aceptan números o nombres (`[\w-]`): `20` equivale al prefijo `20-` del archivo, sin confundirlo con `120-`.

Cubierto por `packages/adapters/src/e2e-local/e2e-local.test.ts` (guarda, entorno y filtros) y `packages/db/src/e2e-seed.integration.test.ts` (seed de ejemplo contra Testcontainers). Los agentes no lo corren: el guard bloquea `pnpm e2e*`; lo corre Mauro o el CI.

## Docker

`infra/docker-compose.yml`: `postgres` (pgvector) + `localstack` (S3, SQS) para desarrollar y correr tests de adapters. `Dockerfile` para `apps/web` (multi-stage, standalone output) aunque prod sea Vercel: sirve para el CV y para la migración a AWS.
