# Fuente: Remote OK

Adapter: `packages/adapters/src/sources/remoteok.ts`. **No conectado al cron** (falta migración del enum `source_kind`: hoy devuelve `kind: "other"` con `externalId` prefijado `remoteok:<id>`).

> Escrito sin red (ronda 07). Todo lo de este documento sale del formato documentado conocido y está **a verificar** contra una respuesta real antes de conectarlo.

## Endpoint
`GET https://remoteok.com/api` → array JSON, una sola llamada. Filtros de fecha y tags en cliente (`fetchRemoteOkJobs({ since, tags?, fetchImpl, baseUrl })`).

## Mapeo campo por campo
| Fuente | RawJob | Nota |
|---|---|---|
| elemento `[0]` (aviso legal, sin `id`/`position`) | descartado | a verificar que siga siendo el primero; se descarta por no tener `id` y `position` |
| `id` | `source.externalId` = `remoteok:<id>` | puede venir string o número |
| `url` (o `apply_url`) | `source.url` | |
| `position` | `title` | |
| `company` | `companyRaw` | vacío → `desconocida` |
| `location` | `locationRaw` = `Remoto (<texto>)` | vacío → `Remoto (países no especificados)` |
| `location` "Worldwide"/"Anywhere" | `countriesAllowed: ["*"]` | cualquier otro texto ("USA", "Europe") → `null` |
| (toda la fuente) | `modality: "remoto"` | |
| `salary_min` / `salary_max` | `salaryMinUsd` / `salaryMaxUsd` | 0 → `null`; periodo `anual` si hay alguno |
| `description` (HTML) | `jdText` | `htmlToText` |
| `epoch` (s) o `date` | `postedAt` | el filtro por `since` usa `epoch` |
| `tags` | `tags` | |
| aviso entero | `source.original` | JSON tal cual |

Quedan `null`: contrato, seniority, idioma, candidatos.

## A verificar contra la fuente real
- Que el primer elemento sea el aviso legal y qué campos trae.
- Nombres exactos de campos y que `salary_*` sean USD anuales.
- Valores reales de `location` (hay textos compuestos tipo "USA, Canada" que hoy quedan con `countriesAllowed: null`).
- Que `epoch` esté en segundos y presente en todos los avisos.
- Si exige cabecera `User-Agent` o limita la frecuencia.

## Términos de uso (pendiente para riesgos)
- Piden atribución con link al aviso original: hay que mostrar `source.url` y la fuente en la UI.
- Frecuencia de consulta permitida y uso de los datos: revisar sus términos antes de conectar.
