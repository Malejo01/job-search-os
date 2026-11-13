# Informe de la tanda R8 (13/11)

Trabajaron cuatro teammates, cada uno en su carpeta: calidad, portales, costos y operacion. El lead revisó los cambios, los commiteó, pasó la revisión de privacidad (y la de seguridad en los rojos sensibles) y abrió los PR. **Ningún PR se mergeó.** Todos salen de `main` (92467dd, con #480), salvo T-1, que va apilado sobre R8-4. Gasto de LLM: **USD 0**. No se mandaron emails reales y no se tocó Neon.

## 1. PRs, en el orden de merge sugerido

| Orden | PR | Ticket | Carril | Antes de mergear |
|---|---|---|---|---|
| 1 | [#484](https://github.com/Malejo01/job-search-os/pull/484) | R8-6 · accesibilidad, segunda pasada | verde | — |
| 2 | [#482](https://github.com/Malejo01/job-search-os/pull/482) | R8-7 · salud de la beta | verde | — |
| 3 | [#489](https://github.com/Malejo01/job-search-os/pull/489) | R8-0 · estados de carga | verde | **No mergear tal cual**: el e2e 79 falla (§3). Cerrar el **#483**, que este reemplaza |
| 4 | [#487](https://github.com/Malejo01/job-search-os/pull/487) | R8-1a · herramienta `inbound:skeleton` | rojo | — |
| 5 | [#486](https://github.com/Malejo01/job-search-os/pull/486) | R8-3 · e2e locales | rojo | Choque trivial en `package.json` de la raíz con #488 (los dos suman scripts) |
| 6 | [#481](https://github.com/Malejo01/job-search-os/pull/481) | R8-4 · índice por `jd_hash` y `DB_POOL_MAX` | rojo | **Migración 0064** en Neon (§4) |
| 7 | [#488](https://github.com/Malejo01/job-search-os/pull/488) | T-1 · cuentas de prueba | rojo | Depende de #481. **Migración 0065 y `rls/0020`** después de la 0064 |
| 8 | [#485](https://github.com/Malejo01/job-search-os/pull/485) | R8-5 · alertas de gasto | rojo | — |
| 9 | este PR | cierre de la R8 | verde | Al final |

`docs/OPERACION.md` lo tocan #481, #485 y #488, en secciones distintas: si choca, es trivial. `pool-max.test.ts` tiene el mismo arreglo de formato en #481 y #488.

**Ramas para un PR de integración**, en este orden:
1. `ronda/r8-6-accesibilidad`
2. `ronda/r8-7-salud`
3. `ronda/r8-0-estados-carga-v2`
4. `ronda/r8-1-bumeran-v2`
5. `ronda/r8-3-e2e-local-v2`
6. `ronda/r8-4-indice-jd-hash`
7. `ronda/t-1-cuentas-de-prueba-v2`
8. `ronda/r8-5-alertas-gasto`
9. `ronda/r8-cierre`

Las ramas sin `-v2` de R8-0, R8-1 y R8-3, y las `ronda/t-1-cuentas-prueba`, `ronda/t-1-cuentas-de-prueba` y `ronda/t-1-generar-0065`, quedaron locales y sin uso (§3).

## 2. Cómo se probó

| Ticket | Pruebas | CI |
|---|---|---|
| R8-0 | Vuelta 1 (#483): 771 e2e pasados, 5 fallos (13, 21, 32, 79, 89) y 2 flaky. Vuelta 2 (#489): esqueleto solo en Hoy y Postulaciones; 777 pasados y 1 fallo, el «Saltar al contenido» del 79 en `/hoy` (falla también en el reintento). | **rojo en e2e** |
| R8-1a | 21 tests de `skeleton.test.ts` con .eml inventados: enmascarado, hosts, `class`/`id`, plantilla y falla cerrada por patrón. No corrió contra los .eml reales, porque el equipo no puede leerlos. | **verde** |
| R8-3 | 21 unit (guarda de localhost, entorno, filtros) y la integración del seed de ejemplo (Testcontainers). Los e2e en local los verifica Mauro. | **verde** |
| R8-4 | 147 unit de db. Integración: el índice existe y el `EXPLAIN` lo usa. | **verde** (lint corregido) |
| R8-5 | Tests primero en pipeline. Integración (10), con un trigger que hace fallar de verdad la marca de un admin y con el lock tomado. Seguridad: 1 media y 3 bajas, todas corregidas o aceptadas. | **verde** (lint corregido) |
| R8-6 | e2e 131 en 18 pantallas: 0 violaciones serias, 0 moderadas y 0 leves con los tags WCAG. | **verde** |
| R8-7 | Tests primero en pipeline (niveles de las señales). El e2e 109 verifica las 10 filas y el 404 para quien no es admin. | **verde** |
| T-1 | Integración db: 233 tests (cuentas de prueba, métricas, auditoría de multiusuario). Integración adapters: 19 tests (registro real, idempotencia, contraseñas fuera de la salida, `--reset-all`, avisos de vencimiento). Seguridad: OK con observaciones, corregidas. | **verde** |

En todos: privacidad PASA antes del push (barrido de historia y texto del PR) y pre-push sin hallazgos. CI completo en verde en todos salvo #489 (R8-0). El único check que falla a propósito es `carril`: ningún PR lleva la etiqueta `carril-verde`, porque el pedido fue sin merge.

## 3. Qué quedó afuera y por qué

- **R8-1 y R8-2 (parsers de Bumeran/ZonaJobs y Computrabajo): bloqueados.** El guard no deja que ningún agente lea `fixtures-private/` (Read, Grep, Glob ni Bash), y escribir un parser sin ver la estructura sería inventar. En su lugar se hizo R8-1a: la herramienta que convierte los .eml en esqueletos sin datos (§4). El plan de los parsers está en `ops/rondas/r8-tanda/R8-1/plan-parsers.md`: ADR corto para el ruteo por usuario, el pool de ADR-024 no se toca, y los mails de Computrabajo que llegan a las casillas del pool siguen por su camino. **R9-5 (pool de Bumeran) queda bloqueado por lo mismo.**
- **R8-8: sin especificar.** El pedido llegó cortado.
- **R8-7: interpretado.** El pedido llegó solo con el título. Se comparó lo que la documentación de la beta dice que hay que mirar cada día con lo que mostraba la pantalla, y se sumaron 4 señales sin migración. Pendiente: «personas activas hoy» sigue contando las cuentas de prueba, porque `is_test` llega con #488 y este PR sale de `main`. Es un `and not is_test` en `apps/web/lib/beta-health.ts`, para después de mergear los dos.
- **R8-0: queda abierta.** Después de las dos vueltas de arreglo que permite CLAUDE.local §6, el #489 falla en un solo e2e: el «Saltar al contenido» del 79 en `/hoy`. Con el `loading.tsx` de Hoy, el foco del teclado sale de `main` cuando el contenido reemplaza al esqueleto. Es una regresión de accesibilidad, no un flaky. Hay dos salidas, y no se hizo una tercera vuelta:
  - (a) dejar el esqueleto solo en `/applications`: una rama nueva desde `main` con `skeleton.tsx`, `applications/loading.tsx` y el spec 125;
  - (b) mandarlo a arquitecto para un esqueleto que no use streaming (solo en la navegación del cliente).
  
  Recomendación: (b), porque el valor de (a) es chico. Antecedentes:
- **R8-0: alcance reducido (vuelta 2).** Con `loading.tsx` o `<Suspense>`, el streaming manda el status 200 antes del `notFound()` y rompe la navegación por searchParams. Además, sin JavaScript, el fallback nunca se reemplaza: el swap es un script inline. Por eso solo `/hoy` y `/applications` tienen esqueleto. **Ojo:** sin JS, esas dos tampoco se reemplazan, y ningún e2e lo cubre. Si el modo sin JS es requisito ahí, no conviene mergear #489. Un esqueleto que funcione sin JS en `/jobs`, `/inbox` y `/market` necesita otro diseño (por ejemplo, un esqueleto solo en la navegación del cliente). Si se retoma, va a arquitecto: ya hubo dos intentos (C6 y R8-0).
- **R8-6:** las reglas best-practice de axe (`heading-order`, `region`) no se miden con los tags WCAG. Conviene una pasada aparte.
- **R8-3:** el guard bloquea `pnpm e2e*` para los agentes, así que la corrida completa la hace Mauro con `!`. La propuesta para que el equipo pueda correrlos (tareas `e2e` y `e2e-prepare` en `.claude/bin/local.mjs`) está en `ops/rondas/r8-tanda/R8-3/propuesta-guard.md`.
- **T-1:** un usuario podría cambiar su propio `is_test` por SQL directo, porque la policy `users_self_update` no restringe columnas. Ningún camino de código lo hace y el impacto es chico. El recorrido no corrió (el guard bloquea Playwright), así que sus selectores pueden pedir un ajuste en la primera corrida.
- **Worktrees y git.** El guard bloquea `git worktree add`, `git mv`, `git rm` y `git apply`, también para el lead. Lo que se hizo en cada caso:
  - **Worktrees:** se reusaron los 4 de tandas anteriores, uno por teammate.
  - **Commits con el patrón #64:** el pre-push barre la historia, y el primer commit de R8-1a y el de R8-3 tenían el patrón #64. Reescribir historia está prohibido, así que se rehicieron en ramas `-v2` (el teammate recreó los archivos finales).
  - **R8-0 sin `git rm`:** para sacar los `loading.tsx` de `/market` y `/plan` hacía falta borrarlos, así que también se rehízo en `-v2`.
  - **Migración 0065:** la generó el lead desde la carpeta principal, porque en un worktree drizzle-kit pide `DATABASE_URL`.
- **Patrón #64:** frenó dos ramas por cadenas de ejemplo inventadas (una URL de Postgres con host con puntos y un remitente ficticio). Es la tercera vez que frena algo ficticio (antes R4-01 y V2).

## 4. Pasos manuales para Mauro

1. **Cerrar el #483**, reemplazado por #489.
2. **Neon, en orden y revisando el SQL antes del `si`:**
   - **0064 (#481).** Si la tabla `evaluations` es chica, `pnpm db:migrate` normal. Si es grande, el camino con `CONCURRENTLY` que explica el PR.
   - **0065 + `rls/0020` (#488),** después de la 0064 y antes de usar `admin:test-users --create` contra Neon.
3. **Esqueletos de los .eml (#487),** desde el worktree que tiene la herramienta o después de mergear. Los comandos exactos están en el PR, para las carpetas `bumeran` y `computrabajo`. La salida va a `ops/rondas/r8-tanda/R8-1/esqueletos/`.
   - **Antes de dejar que un agente los lea, mirá un `.skeleton.html`:** el enmascarado conserva el largo de las palabras.
   - Si un patrón de privacidad coincide, ese .eml queda afuera.
4. **e2e en local (#486),** con Docker abierto: `! pnpm db:up`, `! pnpm e2e:local:prepare` y `! pnpm e2e:local 20 126`. Si funciona, decidir si se aplica `ops/rondas/r8-tanda/R8-3/propuesta-guard.md`.
5. **Cuentas de prueba (#488):** los pasos están arriba de todo en el PR. Conviene correr el recorrido primero en local. Contra producción crea cuentas en Neon y evaluaciones reales: unos USD 0,007 por oferta, hasta 40 ofertas por cuenta y 16 cuentas.
6. **`DB_POOL_MAX` (#481):** opcional. Sin la variable queda en 5, como hoy. La cuenta de conexiones de Neon Free está en `docs/OPERACION.md`; el límite exacto quedó «a confirmar».
7. **Borrar sobrantes sin trackear** (el guard no deja hacerlo al equipo):
   - `apps/web/lib/db-pool.ts` y `db-pool.test.ts` en la carpeta principal;
   - `apps/web/app/(app)/jobs/(lista)/` e `inbox/(lista)/` en `C:/wt/jso-qa`.

## 5. Necesito de vos

1. **R8-8:** el texto del ticket.
2. **R8-7:** confirmar la interpretación (señales nuevas en la pantalla que ya existía) o pasar el texto completo.
3. **R8-0:** el #489 no pasa el e2e 79. Elegir: (a) esqueleto solo en `/applications` o (b) rediseño con arquitecto (recomendado). Y si el modo sin JavaScript es requisito, (a) tampoco sirve.
4. **Patrón #64:** ¿se afina? Ya frenó tres veces cadenas inventadas.
5. **Guard:** ¿se habilita `git rm`/`git mv` para el lead (solo sobre archivos del propio PR) y `git worktree add`? Hoy obligan a rehacer ramas.
