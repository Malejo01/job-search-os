# ADR-009: Neon como base de datos en la nube en vez de Supabase

**Status:** Accepted (auth pendiente) · **Date:** 2026-09-10 · **Deciders:** Mauro

## Context

ADR-001, ADR-002 y el PRD asumían Supabase (Postgres + Auth + RLS con `auth.uid()`). La cuenta de Supabase del autor es una organización gestionada por Vercel que ya tiene los 2 proyectos activos del plan free (otros productos suyos), y no hay slot para un tercero sin pausar uno de ellos. Neon ofrece Postgres 17 con pgvector en plan free y el proyecto `jobsearch` ya está creado (región `us-east-1`, rol `jobsearch_owner`).

## Decision

- **Base en la nube: Neon.** Dos connection strings en `.env.local`: `DATABASE_URL` (pooled, host `-pooler`) para la app en runtime y `DATABASE_URL_UNPOOLED` (directa) para migraciones y seeds. Si falta la unpooled, el código cae a `DATABASE_URL`.
- **Desarrollo diario contra Docker** (`infra/docker-compose.yml`, `pnpm db:migrate:local`, `pnpm db:seed:local`). Neon se usa para paridad y para JS-019 (producción). `--local` o `DB_TARGET=local` eligen el destino.
- **RLS portable.** La migración `0000_prelude` crea, solo si no existen, el rol `authenticated` y la función `auth.uid()` que lee `current_setting('app.user_id', true)`. En Supabase ya existían y el stub no se crea; en Neon y Docker el stub es lo que usan las policies. Las policies (`packages/db/rls/*.sql`) no referencian nada específico de Supabase. En Postgres el dueño de una tabla ignora RLS salvo `FORCE ROW LEVEL SECURITY`, y `jobsearch_owner` además tiene `BYPASSRLS` en Neon: con un solo rol las policies nunca se aplicarían. Por eso (JS-009): todas las tablas con datos de usuario llevan `FORCE ROW LEVEL SECURITY` (`rls/0000_policies.sql`), y la app se conecta con un rol propio `jobsearch_app` (migración `0003_app_role`: LOGIN, sin ownership, sin BYPASSRLS, con SELECT/INSERT/UPDATE/DELETE) que setea `SET LOCAL app.user_id = '<uuid>'` por transacción. Las migraciones, seeds y `db:sql` siguen con el dueño. `DATABASE_URL_APP` lleva la connection string de ese rol (cae a `DATABASE_URL` si falta); en Docker la contraseña la fija `db:migrate --local`, en Neon la carga Mauro. El test de integración incluye un control negativo: con la policy desactivada, el aislamiento desaparece. Desde la migración 0005, `authenticated` es el rol de agrupación: los GRANTs van al grupo y `jobsearch_app` (y los roles de login futuros: anon, service) son miembros. Las policies siguen sin cláusula `TO`.
- **Auth: Auth.js** (decidido en ADR-010, 2026-09-10). Neon Auth descartado por portabilidad.

## Options Considered

| | A: Pausar un proyecto Supabase | B: Neon (elegida) | C: Neon desde Vercel Storage |
|---|---|---|---|
| Costo | 0 | 0 | 0 |
| ADR-002 | Intacto (Supabase Auth) | Auth a definir | Auth a definir |
| Trabajo | Ninguno en código | Split pooled/unpooled + ADR | Igual que B, sin MCP |
| Riesgo | Depende de que Tuki o QPS queden pausados | Dos proveedores (Neon + Vercel) | Org gestionada, sin administración por API |

## Consequences

- `packages/db/src/env.ts` resuelve la URL por destino y propósito; `drizzle.config.ts` usa la unpooled.
- JS-003, JS-014 y JS-019 cambian: la migración se aplica en Neon (hecho el 2026-09-10), el login no usa Supabase Auth, y el deploy carga `DATABASE_URL` y `DATABASE_URL_UNPOOLED` en Vercel.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` salen de `.env.example`. Storage (CV, emails crudos) se resuelve en el bloque 4 con S3-compatible o Vercel Blob; el adapter `storage` sigue siendo intercambiable (ADR-007).
- pgmq no existe en Neon: JS-013 usa una tabla de cola propia con `SKIP LOCKED` y la misma interfaz de adapter.
