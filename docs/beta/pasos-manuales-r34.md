# Pasos manuales de la R34

Lo que tiene que hacer el responsable del proyecto. Ningún agente toca Neon, Vercel ni mergea. Informe de la tanda: `docs/beta/informe-r34.md`. Los pasos de las cinco tandas juntos y en orden: `docs/beta/informe-cadena-r30-r34.md`. Los de esta tanda van **en este orden**.

## 1. Integrar la rama de cierre (carril rojo)

La tanda toca archivos del carril rojo: el PR de cierre lo revisa y mergea el responsable. Lista (comprobala contra `gh pr diff <n> --name-only` y `.github/carril-rojo.txt`):

- **Base de datos:** `packages/db/schema.ts` (`cvOfferVersions`), `packages/db/drizzle/0092_absent_millenium_guard.sql` y `0093_parched_shockwave.sql` con `meta/` (snapshots y journal), `packages/db/rls/0076_cv_offer_versions.sql` y `0077_cv_offer_versions_tope.sql`, `packages/db/src/user-tables.ts` y los tests `src/cv-offer-versions.integration.test.ts`, `delete-account.integration.test.ts` y `multiusuario.integration.test.ts`.
- **Server action nueva:** `saveTailorVersionAction` en `apps/web/lib/cv-tailor/actions.ts` (y `server.ts`, que la verifica).
- **Route handler modificado:** `apps/web/app/(app)/jobs/[id]/postular/descargar/route.ts` (versión base o adaptada, PDF o DOCX, con ritmo de descarga).
- **Evaluador:** `packages/pipeline/src/decide-rules.ts` (nuevo, R34-07) y `packages/adapters/src/worker/evaluate-job.ts`.
- **Listas del carril:** `.github/carril-rojo.txt` y `.github/CODEOWNERS` (suman `decide-rules.ts`).
- **Config de los e2e (R34-08 y R34-03):** `apps/web/playwright.config.ts` suma una persona inventada a `ASSISTANT_TESTER_EMAILS` (la de la puerta vacía del 142) y `MARKET_POOL_CACHE=off` (el servidor de los e2e lee el pool de `/market` sin caché). En producción la variable no existe y el caché sigue.

Verdes: el pipeline de `/market`, de la revisión del CV y de las sugerencias, las pantallas, los textos, el barrido de legibilidad y los e2e. El PR de cierre es rojo entero: lo mergea el responsable.

## 2. Migraciones 0092 y 0093 y RLS 0076 y 0077 en Neon

Dos migraciones y dos RLS, en este orden, solo después de revisar el SQL. Aplicalas con el script de migraciones contra Neon, confirmando con `si`. Nunca `db:seed`. Aplicalas **antes de desplegar el código**: sin la tabla, «Guardar como otra versión» falla con un error genérico y la descarga ofrece solo la versión base.

| Orden | Pieza | Qué hace |
|---|---|---|
| 1 | Migración `0092_absent_millenium_guard.sql` | Tabla `cv_offer_versions` (`user_id` y `job_id` con borrado en cascada, la propuesta decidida en `jsonb` con un CHECK de forma y de tamaño) |
| 2 | Migración `0093_parched_shockwave.sql` | Cambia el índice único por persona y oferta por uno común con la fecha (hasta 3 versiones por oferta) |
| 3 | RLS `0076_cv_offer_versions.sql` | `ENABLE` y `FORCE`, cuatro policies del dueño, permisos de la app |
| 4 | RLS `0077_cv_offer_versions_tope.sql` | Trigger del tope: al insertar la cuarta versión de una oferta borra la más vieja de esa persona (corre con los permisos de quien inserta) |

Antes de empezar, confirmá que el rol que aplica no es `jobsearch_app`:

```sql
SELECT current_user AS rol_de_migracion;
SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('jobsearch_app', current_user);
```

Verificación de solo lectura después de aplicar:

```sql
-- La tabla existe con RLS activa y forzada
SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
 WHERE relnamespace = 'public'::regnamespace AND relname = 'cv_offer_versions';
-- Esperado: una fila con true y true

-- Policies del dueño
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'cv_offer_versions' ORDER BY cmd;
-- Esperado: una por cada comando (select, insert, update, delete)

-- Índices: ninguno único salvo la clave primaria
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'cv_offer_versions' ORDER BY indexname;
-- Esperado: cv_offer_versions_job, cv_offer_versions_pkey y cv_offer_versions_user_job_created

-- El trigger del tope
SELECT tgname FROM pg_trigger WHERE tgrelid = 'cv_offer_versions'::regclass AND NOT tgisinternal;
-- Esperado: cv_offer_versions_tope

-- La tabla está vacía al aplicar (solo conteo)
SELECT count(*) FROM cv_offer_versions;
```

Si algo no coincide, frená y no despliegues.

## 3. `news_email` en `false` para todas las cuentas (decisión del 27/11)

La 0089 no cambia (la columna nace en `true`). Lo corrige el responsable en Neon con un `UPDATE` puntual, después de aplicar la 0089 y antes de mandar el primer email de novedades. Sugerencia, en una transacción y mirando los conteos antes de confirmar:

```sql
BEGIN;
SELECT count(*) FILTER (WHERE news_email) AS en_true, count(*) AS total FROM profiles;
UPDATE profiles SET news_email = false WHERE news_email;
SELECT count(*) FILTER (WHERE news_email) AS en_true_despues FROM profiles;
-- Esperado: 0
COMMIT;
```

## 4. Purgas de borradores y de fichas

No se tocó ningún cron (decisión del 27/11). La purga de borradores del CV (`purgeStaleCvDrafts`, R33) y la de fichas huérfanas (R31, paso 9 de sus pasos manuales) van en un PR rojo aparte, que prepara Claude y revisa el responsable.

## 5. Limpieza que el guard no deja hacer

Cuatro componentes de `/market` quedaron sin uso (nadie los importa). `data-state-notice.tsx` **no** se borra: lo usa `/plan`.

```
git rm "apps/web/app/(app)/market/role-market.tsx" "apps/web/app/(app)/market/skill-candidates.tsx" "apps/web/app/(app)/market/career-picker.tsx" "apps/web/app/(app)/market/skill-rows.tsx"
```

Una rama local vieja del cotejo, con cambios mezclados, que no se publicó y no hay que usar:

```
git branch -D ronda/r34-06-cotejo
```

Y `ronda/r33-trabajo` (local) apunta a un commit anterior al cierre de la R33; la publicada es `ronda/r33-cierre`.

## 6. Memoria de la máquina para correr tests en local

El guard no deja fijar `NODE_OPTIONS` desde la sesión de los agentes. Para lotes pesados, abrí la terminal con:

```
$env:NODE_OPTIONS="--max-old-space-size=4096"
```

antes de arrancar la sesión (los procesos que lanza `local.mjs` la heredan). Los e2e, de a un spec: con varios a la vez el sistema corta por memoria.

## 7. El ensayo con 5 personas (compuerta B)

El guion está en `docs/beta/ensayo-beta.md`: qué se les pide, qué se mira sin intervenir, cuándo cuenta como recorrido completo y qué anotar. Antes: integrar la cadena entera, aplicar las migraciones de las cinco tandas y tener al menos una carrera abierta. La revisora consigue a las personas.

## 8. Terminar la auditoría de legibilidad 440 con el build de producción

Con `next dev` la auditoría no entra entera en memoria: el servidor se reinicia solo después de unas 43 páginas. Quedaron sin correr tres casos (1280 px claro al 200 %, y 390 y 1280 px oscuro al 200 %) y `/en/how-its-built` en oscuro. Todo lo que corrió al 100 % dio 0 hallazgos (ver `docs/beta/informe-r34.md`). El CI no la corre (es una auditoría y pide `AUDITORIA=1`). Para terminarla, con Docker abierto y la base local migrada, en PowerShell:

```
pnpm --filter @job-search-os/web build
$env:CI="1"; $env:AUDITORIA="1"; pnpm --filter @job-search-os/web e2e e2e.440- --grep "200 %|1280 px, zoom 100 %, en oscuro"
```

(`CI=1` hace que la config use `next start` en vez de `next dev`.) El resumen queda en `ops/capturas/r34/legibilidad/resumen-<fecha-hora>.md`, con capturas de lo que falla, para la revisión de diseño.

## 9. Lo no verificado

- Las migraciones 0092 y 0093 y las RLS 0076 y 0077 solo se probaron en la base local con Docker, no en Neon.
- La descarga en PDF y DOCX de la versión adaptada no se abrió en lectores reales (como en la R33, paso 5).
- El e2e 445 corre con el modelo simulado; el tramo de la pregunta de un toque necesita la ficha encendida (`JOB_CARD=testers`) y se saltea con motivo si no está.
- La auditoría 440 y los e2e corrieron con `next dev` en la máquina local, de a un spec.
- Ningún texto nuevo lo leyó todavía una persona real: el ensayo es la primera prueba.
