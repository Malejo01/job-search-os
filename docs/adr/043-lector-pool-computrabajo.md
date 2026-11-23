# ADR-043: Lector de las alertas de Computrabajo para el pool (construido, apagado)

**Status:** Proposed · **Date:** 2026-11-22 · **Amplía:** ADR-024 §9 · **Relacionada:** ADR-036, ADR-037, ADR-039

## Context
- ADR-024 §9 dice que, sin un lector validado con emails reales, todo email de una casilla `pool-*` va a la
  cola manual del pool. Hasta hoy no llegó ninguna alerta real a esas casillas: la alerta de Computrabajo
  sin cuenta falla al mandar la verificación.
- Las alertas van a llegar desde el Gmail de personas de la beta, reenviadas con un filtro a
  `pool-<carrera>@`. El mail de recomendaciones de Computrabajo ya se lee para la casilla de una persona
  (R11-4, ADR-037), con una estructura conocida de 4 esqueletos.
- ADR-036 sigue igual: Bumeran no entra al pool porque su email no trae el link al aviso.

## Decision
Se construye el lector con la estructura conocida y queda **apagado**. Se valida con el primer email real
antes de prenderlo. Lo que cambia respecto de ADR-024 §9:

1. **Parser `pool_computrabajo_alerts`** (`packages/adapters/src/inbound/pool-computrabajo.ts`). Reusa la
   lectura de tarjetas de `computrabajo.ts` (extraída a `readComputrabajoCards`, sin cambiar su
   comportamiento). De cada tarjeta salen título, empresa, ubicación y, del `url=` del tracker, la URL
   pública del aviso. El `externalId` es el ID de 32 hex de esa URL.
2. **Se descartan todos los parámetros del tracker** (`ipo`, `idu`, `isd`…): identifican a quien recibió el
   email y el pool no tiene `user_id`. Solo queda la URL pública, sin query ni fragmento.
3. **Interruptor propio `POOL_COMPUTRABAJO_READER`**, apagado por defecto (solo el valor exacto `1` lo
   prende) e independiente de `POOL_SOURCE_COMPUTRABAJO_ALERTS`, que sigue habilitando las casillas.
   Apagado, todo igual que hoy: el email va a la cola manual del pool.
4. **Prendido, cada aviso entra a `public_jobs`** con fuente `computrabajo_alerts` (el valor del enum de
   la migración 0046), nombre «vía Computrabajo» (ADR-024 §4), `role_hints` = la carrera de la casilla (no
   se infiere del título) y `countriesAllowed: null`. Se deduplica por `(source_kind, external_id)`.
5. **Falla cerrado.** Estructura desconocida, recordatorio, seguimiento de una empresa, link que no es de
   Computrabajo, tracker sin `url=`, ID que no es de 32 hex, más de 100 tarjetas o HTML de más de 1 MB:
   `{ ok: false }` y el email entero queda en la cola manual con el motivo. Nunca extracción parcial. Un
   email de más de 256 KB sigue guardándose solo con metadatos y no se lee.
6. **Esqueleto al log**, sin texto ni links: conteos de tarjetas, celdas y links del tracker, nombres de
   parámetros conocidos, conteo de etiquetas y una huella de 12 hex de la secuencia de etiquetas. Sirve
   para comparar el primer email real con lo esperado sin guardar su contenido. No usa `skeleton.ts`
   (que necesita los patrones privados de `fixtures-private/` y corre solo como herramienta local).
7. Un email leído sin errores queda con `error` null, `jobs_extracted` = avisos y `seen_at` puesto; con
   avisos que fallaron al cargar queda en la cola con el motivo.

## Qué falta para prenderlo
- Un email real reenviado, comparado con el esqueleto del log (misma huella o diferencias explicadas).
- Si coincide, `POOL_COMPUTRABAJO_READER=1` en el entorno. Lo hace el dueño del proyecto, no un agente.
- Reprocesar la cola que se haya juntado (ticket aparte: `pnpm pool:reprocess`).

## Consequences
- ADR-024 §9 deja de ser «no hay lector» y pasa a ser «hay lector, apagado, sin validar con un email real».
- Mientras no se prenda, nada cambia: cola manual para todo.
- Pendiente de tipos: `SourceKind` de `packages/pipeline` todavía no lista `computrabajo_alerts` ni tiene
  entrada en `SOURCE_ATTRIBUTION`; el lector usa un cast en un solo lugar. Hay que agregarlo en pipeline.
- No es asesoramiento legal.
