# Torre

Adapter: `packages/adapters/src/sources/torre.ts`. Estado: **no conectado al cron** (falta la migración del enum `source_kind`; hoy devuelve `kind: "other"` y `externalId` con prefijo `torre:`).

**Torre no tiene una API pública de avisos documentada.** Lo que hay es el buscador público que usa su web. Todo lo de abajo (endpoint, body de filtros, forma del resultado) es **a verificar** y puede cambiar o estar prohibido sin aviso.

## Endpoint (a verificar)
`POST https://search.torre.co/opportunities/_search/?size=N&offset=M` con filtros en el body (por defecto `{ "and": [{ "remote": { "term": true } }] }`) → `{ results, total, size, offset }`.

## Mapeo
| Torre | RawJob |
|---|---|
| `id` | `source.externalId = torre:<id>`; `url = https://torre.ai/post/<id>` (a verificar) |
| `objective`, `organizations[0].name` | `title`, `companyRaw` |
| sin `id` o sin `objective` | se descarta y se cuenta en `skipped` (falla cerrado) |
| `remote: true` | `modality: "remoto"` |
| `remote: false` | `"desconocida"`; `"hibrido"`/`"presencial"` solo si `type` o `locations` lo dicen |
| `locations[]` | `locationRaw`; `countriesAllowed: null` salvo "Worldwide"/"Anywhere" explícito en un remoto (`["*"]`), porque puede ser la sede y no una restricción |
| `compensation` USD | `salaryMinUsd/MaxUsd` y `salaryPeriod` (monthly/yearly/hourly); otra moneda → `salaryNote` |
| `description` (si viene) | `jdText` vía `htmlToText`; si no, `null` (queda `pendiente_jd`) |
| `created` | `postedAt` |
| `skills[].name`, `type` | `tags`, `contractType` |

## A verificar
- Que el endpoint y el body sigan existiendo tal cual, y los filtros disponibles.
- Forma de `compensation` (¿anidada en `data`?), valores de `currency` (puede venir como "USD$") y `periodicity`.
- Si el resultado trae descripción; si no, no hay JD y habría que pedir cada aviso aparte.
- Orden de los resultados (el corte por `since` supone fecha desc) y tope de `size`.
- Qué significa `locations` en un remoto (sede o restricción).

## Pregunta para riesgos
¿Los términos de uso de Torre permiten consultar su buscador de forma automatizada y reutilizar los avisos? No hay API pública que lo habilite explícitamente; antes de conectar hay que leer los términos y, si no hay permiso claro, descartar la fuente.
