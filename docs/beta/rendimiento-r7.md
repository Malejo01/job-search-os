# Rendimiento de las pantallas: análisis por código (R7-6)

Origen: hallazgo 29 de `docs/ux/auditoria-r4.md` (`/plan` entre 6,6 y 8,8 s en `next dev`). Esa medición era de desarrollo y orientativa. Este documento no mide: analiza el código y cuenta consultas. La medición real la hace Mauro (ver más abajo).

Qué se tocó: solo el orden en que se piden los datos. Lo que se muestra no cambia, ni las consultas, ni los permisos. No hay índices ni migraciones.

## Qué cambió, por pantalla

Una «ronda» es una espera: las consultas de una misma ronda salen a la vez.

| Pantalla | Antes | Después | Cambio |
| --- | --- | --- | --- |
| Layout de `(app)` (todas las pantallas con sesión) | 7 esperas en serie: términos, onboarding, invitar, asistente, seguimientos, plan, nombre | 1 ronda (más la verificación de sesión, que ya iba antes) | Las consultas no dependen entre sí: salen juntas. Los gates siguen en el mismo orden (términos y después onboarding) y redirigen igual |
| `/hoy` y las pantallas que llaman `requireActiveUserId` | Términos y onboarding se repetían: el layout y la página los consultaban por separado | Una sola vez por navegación | El layout ahora usa `requireActiveUserId`, que tiene `cache` por request: la página reutiliza el resultado |
| `/plan` | 3 rondas: puesto, luego (plan, estado de datos, ofertas propias), luego impacto | 2 rondas: (puesto, plan, estado), luego (ofertas propias, impacto) | El impacto («Si aprendés…») ya no espera a las ofertas propias |
| `/jobs` | 6 esperas en serie: ciudad, (lista, duplicados, progreso), conteos, pasos ocultos, oferta del panel | 2 rondas: ciudad y después (lista, duplicados, progreso), en paralelo con conteos, pasos ocultos y oferta del panel | Solo la ciudad condiciona la lista (entra a los filtros) |
| `/cv` | 2 en serie: armado del CV y permiso del chat | 1 ronda | Independientes |
| `/settings` | 2 rondas: 7 consultas y después el email | 1 ronda de 8 consultas | El email va con el resto |

Una espera en serie cuesta una ida y vuelta a la base más el tiempo de la consulta. Contra Neon (que es otro servidor) cada ida y vuelta pesa más que en local, por eso el layout, que corre en cada navegación, es lo que más debería notarse.

## Lo que se revisó y no se tocó

- `/market`: ya usaba `Promise.all` para seis consultas; las tres que dependen del puesto quedan después de pedir el puesto, y mover las otras tres no acorta el camino (la ronda más larga es la misma).
- `/encaje`: depende del puesto para todo; una sola consulta pesada (`getFitData`).
- `/jobs/[id]`: ya usa `Promise.all`. `getMainFitSummary` se pide después solo si la oferta tiene descarte rápido; depende de la evaluación, así que no se puede adelantar sin pedirla siempre.
- `/applications`: ya usaba `Promise.all`.
- Sin N+1 evidentes en estas pantallas. Sin llamadas a servicios externos en el render (el impacto del plan es caché de 30 minutos, `unstable_cache`).
- `<Suspense>` con esqueletos: no se agregó. Cambiaría lo que se ve durante la carga y el hallazgo 29 propone un `loading.tsx` en `(app)`. Queda como idea para un ticket de UI (ver abajo).

## Para el lead: ideas que no hice

1. **Índices:** no encontré uno que falte con evidencia. Las consultas de `/plan`, `/jobs` y las evaluaciones por fecha ya tienen índice por `user_id` (por ejemplo `evaluations_user_created`, `jobs_user_first_seen`, `learning_plan_items_user_priority`). Sin `EXPLAIN` sobre una base con datos no propongo ninguno. Si la medición muestra una consulta lenta, se mira ahí.
2. **`loading.tsx` en `(app)`** con esqueleto (hallazgo 29): ticket de UI aparte; hace que la navegación se sienta más rápida sin cambiar los tiempos del servidor.
3. **Pool de conexiones:** `getAppDb` usa `max: 5`. Con el layout en paralelo, una navegación abre hasta 6 transacciones a la vez más las de la página: las que no entran esperan turno. Si la medición muestra espera, subir `max` es un cambio en `apps/web/lib/db.ts` (carril rojo) y hay que mirar el límite de conexiones de Neon antes.

## Cómo medirlo (Mauro)

Con el mismo usuario y los mismos datos, antes y después:

1. **En la preview de Vercel** de la rama `ronda/r7-6-pantallas-lentas` y de `main`: DevTools, pestaña Network, recargar cada pantalla con «Disable cache» y anotar el TTFB del documento (columna Waiting for server response). Repetir 5 veces y anotar la mediana; la primera carga tras un rato de inactividad es en frío y se anota aparte.
2. **En local:** `pnpm --filter @job-search-os/web build` y después `node .claude/bin/local.mjs dev` contra una base con datos (el snapshot no sirve para esto: es de producción). La base local vacía no muestra diferencias.

No usar `pnpm dev` sin `DB_TARGET=local`: apunta a Neon.

## Tabla antes / después (para llenar)

Mediana de 5 cargas, en milisegundos de TTFB. Fecha y entorno: ________

| Pantalla | Antes (frío) | Antes (tibio) | Después (frío) | Después (tibio) |
| --- | --- | --- | --- | --- |
| `/hoy` | | | | |
| `/jobs` | | | | |
| `/jobs/[id]` | | | | |
| `/plan` | | | | |
| `/market` | | | | |
| `/cv` | | | | |
| `/applications` | | | | |
| `/settings` | | | | |

`/jobs/[id]`, `/market` y `/applications` solo se benefician del layout.
