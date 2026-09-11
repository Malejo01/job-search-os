# CLAUDE.md — reglas para agentes de código en este repo

Leé `docs/PRD.md` y `docs/ARCHITECTURE.md` antes de tocar cualquier cosa. Las decisiones están en `docs/adr/`; no las reabras en un PR, abrí un ADR nuevo.

## Flujo de trabajo

1. Un ticket de `docs/BACKLOG.md` por rama: `feat/JS-012-prefilter`.
2. Antes de escribir código: leer el ticket completo, sus dependencias y los tests que exige. Si algo es ambiguo, elegir la opción más simple y dejarlo escrito en el PR, no preguntar por cada detalle.
3. Tests primero cuando el ticket toca `packages/pipeline`.
4. `pnpm lint && pnpm typecheck && pnpm test` verdes antes de abrir PR.
5. PR con: qué hace, cómo se probó, qué queda fuera. Sin merge automático; Mauro revisa.
6. Nunca hacer commit de `.env*`, credenciales, ni fixtures con datos personales del usuario.

## Reglas de arquitectura (no negociables)

- `packages/pipeline` no importa `db`, `adapters` ni hace I/O. Recibe datos, devuelve decisiones.
- Prompts viven en `packages/prompts/*.md` con frontmatter `version`. Nunca inline en TS.
- Toda tabla nueva con datos de usuario lleva `user_id` + policy RLS en la misma migración.
- Ningún código que navegue LinkedIn ni que envíe postulaciones (ADR-004). Rechazar el ticket si lo pide.
- Modelos LLM se leen de `model_routing`; nunca hardcodear un nombre de modelo fuera de `seeds/model_routing.json`.
- Server Components por defecto; `"use client"` solo para interactividad real. Framer Motion solo en client components.
- Migraciones con `drizzle-kit generate`; nunca editar SQL generado a mano salvo para policies RLS (van en `packages/db/rls/*.sql`).

## Stack fijo

Next.js 15 App Router · TypeScript strict · Tailwind · Framer Motion · Drizzle + Postgres (Supabase) · Vercel AI SDK · Zod · Vitest · Playwright · pnpm + Turborepo.

## Convenciones

- Español en docs, comentarios y strings de UI. Inglés en identificadores de código.
- Errores: `Result<T, E>` en pipeline; excepciones solo en bordes (adapters, route handlers).
- Logs con pino: siempre `user_id`, `job_id`/`run_id` cuando existan.
- Nombres de tareas LLM: `snake_case` y registradas en `model_routing`.

## Cuando termines un ticket

Actualizá `docs/BACKLOG.md` (estado → done, fecha) y, si cambiaste una decisión, el ADR correspondiente. No toques `evals/fixtures/golden.json` salvo que el ticket lo diga.
