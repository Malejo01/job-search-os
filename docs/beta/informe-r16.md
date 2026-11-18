# Informe de la tanda R16 «Más ofertas para todas las carreras» (18/11, noche)

**Ningún PR se mergeó y ningún PR está abierto todavía:** las ramas están pusheadas y los textos de cada PR quedaron listos. Lo que traba la apertura está en el paso 1 de `docs/beta/informe-r13.md`. **Ninguna fuente nueva se prende sola, y nada se probó contra una API real.**

## 1. Ramas de la tanda

| Rama | Ticket | Sale de | Carril | Antes de mergear |
|---|---|---|---|---|
| `ronda/r16-4-cobertura-pool` | R16-4 · cobertura del pool por carrera en el admin | `origin/main` | verde | e2e 149 en el CI |
| `ronda/r16-3-teamtailor-json` | R16-3 · lector del JSON Feed de Teamtailor | `origin/main` | verde | — |
| `ronda/r16-1-careerjet` | R16-1 · Careerjet, adaptador apagado | `ronda/r13-8-jooble` | verde | Después de R13-8 |
| `ronda/r16-2-workable` | R16-2 · Workable, adaptador de ATS apagado | `ronda/r15-2-plan-override` | rojo | **Falta generar la migración 0068** (§4) |
| `ronda/r16-cierre` | Este informe y el Bloque 30 | `origin/main` | verde | Al final |

## 2. Orden de integración de las cuatro tandas

```
ronda/r13-1-confirmacion-gmail
ronda/r13-3-ruteo-cola-manual
ronda/r13-2-filtro-bumeran
ronda/r13-5-detalles-r12
ronda/r13-6-reservas-bajo-lock
ronda/r13-9-doc-rol-app
ronda/r15-3-dominio-viejo
ronda/r15-4-privacidad-ia
ronda/r14-1-puestos-marketing
ronda/r14-4-feedback-admin
ronda/r14-2-cv-legible-ats
ronda/r13-8-jooble
ronda/r16-1-careerjet
ronda/r16-3-teamtailor-json
ronda/r16-4-cobertura-pool
ronda/r15-1-planes-v2
ronda/r15-2-plan-override        (después de generar la 0067)
ronda/r16-2-workable             (después de generar la 0068)
ronda/r13-4-e2e-135              (solo con el job e2e en verde)
ronda/r14-3-personas-carreras    (solo con el job e2e en verde)
ronda/r13-cierre
ronda/r14-cierre
ronda/r15-cierre
ronda/r16-cierre
```

## 3. Qué se probó y qué no

**La mezcla completa no se probó:** el guard del equipo bloquea `git merge`. Los choques de abajo salen de comparar la lista de archivos de cada rama.

| Archivo | Ramas | Qué hacer |
|---|---|---|
| `packages/adapters/src/pool/fetch.ts`, `fetch.test.ts` y `fetch.integration.test.ts` | R13-8, R16-1, R16-2 y R16-3 | Conservar las fuentes de todas en cada `Record<PoolSourceName, …>` |
| `packages/adapters/src/pool/cli.ts` | R15-3, R16-2 y R16-3 | Son cambios en lugares distintos |
| `packages/adapters/src/sources/ats-common.ts` | R16-2 y R16-3 | Conservar los dos |
| `apps/web/app/(app)/settings/page.tsx` | R15-1 y R15-2 | Ver el informe de la R15 |
| `apps/web/components/profile-agent/read-client.tsx` | R13-5 y R14-2 | Ver el informe de la R14 |
| `packages/pipeline/src/index.ts` | R14-2, R15-1 y R15-2 | Una línea de `export` por rama |
| `docs/BACKLOG.md` | Los cuatro cierres | Conservar los bloques 27 a 30, en orden |

**Pruebas por rama:**

- **R16-1:** tests de `src/pool` e integración de `fetch` (5 de 5).
- **R16-2:** `pipeline` y `adapters` en verde. **Los casos nuevos de integración de `ats_boards` fallan hasta que exista la migración.**
- **R16-3:** tests de `src/sources` y `src/pool`.
- **R16-4:** 14 tests de la lógica y 7 de integración. El e2e 149 no se ejecutó.

## 4. Pasos manuales para el dueño del proyecto

1. **R16-2, generar la migración 0068**, después de la 0067 de R15-2: `pnpm db:generate` desde `ronda/r16-2-workable`. Revisar el SQL contra el del PR, commitearlo y aplicarlo en Neon.
2. **Antes de prender Workable:** leer sus términos, confirmar que el endpoint sin clave es de consumo público, y correr `pnpm pool:fetch workable <cuenta> --dry-run`.
3. **Antes de prender Careerjet:** confirmar por escrito que permite el uso desde un servidor, sin visitante. La API pide la IP y el navegador de quien busca, y el pool corre en un cron. **Si exige el visitante real, esta fuente no sirve para el pool.** Variables: `CAREERJET_AFFID` y `CAREERJET_CALLER_IP`.
4. **Antes de prender Teamtailor por JSON:** correr `pool:fetch teamtailor <token> --dry-run` contra un board real y mapear modalidad y ubicación.

## 5. Qué quedó abierto

- **R16-3 no pasó Teamtailor a JSON Feed.** El lector está, pero los avisos siguen saliendo del RSS. El JSON Feed estándar no trae modalidad, y con él los avisos presenciales habrían entrado al pool como remotos.
- **Jooble y Careerjet no se pueden prender a la vez.** Comparten `source_kind = other`, y el intervalo mínimo se calcula por ese valor. Hace falta darle a una su propio valor con una migración.
- **Falta «vía Jooble» y «vía Careerjet» en pantalla.** Es condición para prender esas fuentes.
- **R16-2:** el formato de la respuesta de Workable está asumido, no grabado.
- **R16-1:** el endpoint, los campos y el tope diario de Careerjet están marcados «a verificar».

## 6. Gasto de evals

USD 0 en las cuatro tandas. Ninguna rama toca `packages/prompts/**` ni `evals/**`.
