# ADR-010: Auth.js en vez de Neon Auth

**Status:** Accepted · **Date:** 2026-09-10 · **Deciders:** Mauro

## Context

ADR-009 dejó la base en Neon y la autenticación pendiente entre Neon Auth (Better Auth gestionado por Neon, con tablas en el schema `neon_auth` de la misma base) y Auth.js (NextAuth v5) con sesiones propias. Las policies RLS ya son portables: leen `auth.uid()`, que en Neon y Docker es un stub sobre `current_setting('app.user_id')`, y la app se conecta con `jobsearch_app`, un rol sin ownership ni `BYPASSRLS` (JS-009). Lo único que falta es quién pone el `user_id` en cada request.

## Decision

**Auth.js** (`next-auth` v5) con el adapter de Drizzle sobre las tablas `users`, `accounts`, `sessions` y `verification_tokens` en el schema `public` de la misma base, estrategia de sesión en base de datos y un solo proveedor en fase 1: email + contraseña (Credentials) para el único usuario, sin registro público. `profiles.user_id` referencia `users.id`.

Cada request autenticado abre una transacción, ejecuta `SET LOCAL app.user_id = '<users.id>'` y corre las consultas de la app con `jobsearch_app`; las policies hacen el resto. Crons y webhooks siguen con el rol dueño (purpose `service`) y filtran por `user_id` explícito (ARCHITECTURE §4).

## Options Considered

| | A: Neon Auth | B: Auth.js (elegida) | C: Supabase Auth (volver a ADR-002) |
|---|---|---|---|
| Dónde viven los usuarios | schema `neon_auth`, gestionado por Neon | tablas propias en `public`, migradas con Drizzle | proyecto Supabase (sin slot libre) |
| Portabilidad (ADR-007, AWS) | atada a Neon | ninguna dependencia del proveedor de base | atada a Supabase |
| RLS por request | `SET LOCAL app.user_id` con el id de Neon Auth | `SET LOCAL app.user_id` con `users.id` | `auth.uid()` nativo |
| Proveedores OAuth (fase 3) | gestionados por Neon | Google/GitHub con la misma librería, sin cambiar el modelo | gestionados por Supabase |
| Costo | 0 | 0 | 0 (si hubiera slot) |
| Riesgo | producto joven, superficie de configuración fuera del repo | mantener Credentials con hash propio (argon2/bcrypt) y rate limit en login | volver atrás en ADR-009 |

## Consequences

- JS-014 crea las tablas de Auth.js con `drizzle-kit generate` y las policies correspondientes (`users` solo lectura del propio registro; `sessions`/`accounts` por `user_id`), el login con Credentials y el middleware que redirige sin sesión.
- El seed del usuario de Mauro deja de usar un UUID fijo inventado: `profiles.user_id` = `users.id` creado por el seed con contraseña desde `SEED_USER_PASSWORD` (nunca en el repo).
- La app valida que el rol de `DATABASE_URL_APP` no tenga `BYPASSRLS` ni sea dueño de tablas: si lo es, falla ruidosamente (JS-014). Corre una vez por proceso en el primer request (layout de la app y `withUser`), no en `instrumentation.ts`: Next compila ese hook también para edge y el cliente de Postgres no entra en ese bundle. En serverless es lo mismo que "al arrancar".
- **Ajuste al implementar (JS-014, 2026-09-11):** Auth.js no admite sesiones en base de datos con el proveedor Credentials, así que la sesión es un JWT firmado con `AUTH_SECRET` (cookie httpOnly, 30 días) que lleva `users.id` en `sub`; las tablas `accounts`/`sessions`/`verification_tokens` del adapter quedan para cuando entre OAuth (fase 3). Solo existe `users` (id, email único, name, password_hash con scrypt de Node, sin dependencias). Policies: `users_read` abierta al rol de la app (el login resuelve el email sin sesión; un solo usuario, sin registro) y `users_self_update` por `id = auth.uid()`; sin INSERT/DELETE para la app. La FK `profiles.user_id → users.id` se difiere: el seed crea el usuario después de migrar y las filas existentes de `profiles` la violarían en la migración.
- Fase 3: agregar Google OAuth es un proveedor más en la misma configuración; abrir registro a terceros es una decisión de producto, no técnica.
- Se descarta Neon Auth: no aporta nada que Auth.js no dé, y ata la identidad al proveedor de base justo cuando ADR-007 pide poder migrar.
