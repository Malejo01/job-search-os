# CLAUDE.md — reglas para agentes de código en este repo

Leé `docs/PRD.md` y `docs/ARCHITECTURE.md` antes de tocar cualquier cosa. Las decisiones están en `docs/adr/`; no las reabras en un PR, abrí un ADR nuevo.

## Flujo de trabajo

1. Un ticket de `docs/BACKLOG.md` por rama: `feat/JS-012-prefilter`.
2. Antes de escribir código: leer el ticket completo, sus dependencias y los tests que exige. Si algo es ambiguo, elegir la opción más simple y dejarlo escrito en el PR, no preguntar por cada detalle.
3. Tests primero cuando el ticket toca `packages/pipeline`.
4. `pnpm lint && pnpm typecheck && pnpm test` verdes antes de abrir PR.
5. PR con: qué hace, cómo se probó, qué queda fuera. Sin merge automático; Mauro revisa.
6. Nunca hacer commit de `.env*`, credenciales, ni fixtures con datos personales del usuario.
7. Contra producción (Neon): migraciones sí (`pnpm db:migrate`), **seed no**. `pnpm db:seed` reescribe perfil y golden; para cambiar un dato puntual va un `UPDATE` puntual. `pnpm db:migrate` sin `--local` apunta a Neon: en local usar `pnpm db:migrate:local`. Contra una base remota el script pide confirmar con `si` (o `CONFIRM_PRODUCTION=si`); un agente no lo usa sin que Mauro haya revisado el SQL.
8. Datos reales del usuario (emails `.eml`, golden, perfil) viven en `fixtures-private/`, que está en `.gitignore`. Las fixtures públicas se derivan de ahí: solo el fragmento necesario, sin nombre, email, titular de perfil ni tokens de tracking, y con empresas y títulos ficticios. Van en `.prettierignore` si son HTML capturado, para que el formateo no altere lo que prueban.
9. Docker Desktop en la máquina de Mauro se abre a mano y se cae solo: antes de correr integración, e2e o `pnpm secrets:scan`, pedirle que lo abra en vez de intentar arrancarlo. Si no está, esos tests quedan para el CI, que levanta su propio Postgres.

## Reglas de arquitectura (no negociables)

- `packages/pipeline` no importa `db`, `adapters` ni hace I/O. Recibe datos, devuelve decisiones.
- Prompts viven en `packages/prompts/*.md` con frontmatter `version`. Nunca inline en TS.
- Toda tabla nueva con datos de usuario lleva `user_id` + policy RLS en la misma migración.
- Ningún código que navegue LinkedIn ni que envíe postulaciones (ADR-004). Rechazar el ticket si lo pide.
- Modelos LLM se leen de `model_routing`; nunca hardcodear un nombre de modelo fuera de `seeds/model_routing.json`.
- Server Components por defecto; `"use client"` solo para interactividad real. Framer Motion solo en client components.
- Migraciones con `drizzle-kit generate`; nunca editar SQL generado a mano salvo para policies RLS (van en `packages/db/rls/*.sql`).
- Los parsers de email **fallan cerrado**: si la estructura no es la esperada devuelven `{ ok: false }` y el email entero va a la cola manual. Nunca extracción parcial ni campos inventados. Lo que el email no dice queda `null` — en particular `countriesAllowed`, para que el prefiltro marque riesgo de ubicación en vez de asumir "cualquier país".
- Contenido que viene de afuera (HTML de emails) nunca se inyecta en la página: va en un `iframe` con `sandbox` vacío.

## Stack fijo

Next.js 15 App Router · TypeScript strict · Tailwind · Framer Motion · Drizzle + Postgres (Supabase) · Vercel AI SDK · Zod · Vitest · Playwright · pnpm + Turborepo.

## Convenciones

- Español en docs, comentarios y strings de UI. Inglés en identificadores de código.
- Errores: `Result<T, E>` en pipeline; excepciones solo en bordes (adapters, route handlers).
- Logs con pino: siempre `user_id`, `job_id`/`run_id` cuando existan.
- Nombres de tareas LLM: `snake_case` y registradas en `model_routing`.

## Cuando termines un ticket

Actualizá `docs/BACKLOG.md` (estado → done, fecha) y, si cambiaste una decisión, el ADR correspondiente. No toques `evals/fixtures/golden.json` salvo que el ticket lo diga.
