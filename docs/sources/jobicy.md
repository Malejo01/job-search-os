# Fuente: Jobicy

Adapter: `packages/adapters/src/sources/jobicy.ts`. Estado: **pool global (JS-137)**, **apagada hasta definir `POOL_SOURCES`** (recomendada, de a una y tras el `--dry-run`).

## Endpoint
`GET https://jobicy.com/api/v2/remote-jobs?count=200&industry=X` y `&geo=latam` → `{ jobs: [...] }` (los otros campos se ignoran).
Llamadas en serie por industria (`legal`, `accounting-finance`, `marketing`, `copywriting`, `management`, `project-management`, `business`, `admin-support`) más una con `geo=latam` (R1-8). Deduplica en memoria por `id` (`externalId`) y combina categorías de distintas consultas para no perder pistas de puesto. La ventana de la fuente es de 7 días; el filtro por fecha (48 h) se hace en cliente. Si `jobs` no es un array: error `Jobicy: respuesta inesperada`.

## Mapeo
| Jobicy | RawJob | Nota |
|---|---|---|
| `id` | `source.externalId` | string, **sin prefijo**; la unicidad la da `source.kind = "jobicy"` |
| `url` | `source.url` | tal cual: sus términos piden conservar la URL canónica |
| `jobTitle` | `title` | |
| `companyName` | `companyRaw` | vacío → `desconocida` |
| (toda la fuente) | `modality: "remoto"` | |
| `jobGeo` "Anywhere"/"Worldwide" | `countriesAllowed: ["*"]` | |
| `jobGeo` con un país conocido | `countriesAllowed: [ISO-2]` | vía `countryToIso` de `getonboard.ts` |
| `jobGeo` región, lista, vacío o país desconocido | `null` | el prefiltro marca el riesgo de ubicación |
| `salaryMin/Max` + `salaryPeriod` + `salaryCurrency` = USD | `salaryMinUsd/MaxUsd`, `salaryPeriod` | `year`/`annual` → `anual`, `month` → `mensual`, `hour` → `hora`. Gana esta forma si trae algún número |
| `annualSalaryMin/Max` + `salaryCurrency` = USD (forma anterior, solo si no hay `salaryMin/Max`) | `salaryMinUsd/MaxUsd`, `salaryPeriod: "anual"` | |
| período desconocido o ausente en `salaryMin/Max` | solo `salaryNote` ("… (período no indicado)") | D-017: no se supone el período |
| salario en otra moneda o sin moneda | solo `salaryNote` | D-017: no se supone la moneda |
| `jobDescription` (HTML) | `jdText` | `htmlToText` |
| `pubDate` | `postedAt` | ISO o `YYYY-MM-DD HH:MM:SS` (UTC); inválida → `null` y el aviso no pasa el filtro |
| `jobIndustry` | `categories` | minúsculas con guiones; los slugs reales se verifican con `pool:fetch jobicy --dry-run` (top 20 con conteo) |
| `jobType` | `contractType` | varias → unidas con coma |
| `jobLevel` | `seniority` | |
| aviso entero | `source.original` | JSON tal cual |

Sin `id`, `url` o `jobTitle` el aviso falla cerrado (`null`) y se cuenta en `skipped`.

## Términos citados
Fuente: `ops/rondas/37-38-39/informes/riesgos-fuentes.md` §3 (consultado el 2026-10-12 con un resumidor automático; no es asesoramiento legal).
- https://jobicy.com/jobs-rss-feed: "Start a new automated pass no more than once per hour."
- Atribución: "Please credit Jobicy and link to the source", "Keep Jobicy as the original source and preserve the canonical Jobicy job URL when displaying listings", "Use of content requires a clickable source link".
- Prohíbe presentar los avisos como propios o quitar la atribución. Acuerdo aparte para "high-volume commercial partnerships or custom data arrangements".
- https://jobicy.com/terms-and-conditions.md: prohíbe "Harvest or scrape data (other than via our official API under its terms)" y explotar comercialmente el sitio sin acuerdo.
- **Duda abierta:** la cláusula contra explotación comercial si JSO cobra algún día.

Consecuencias en el código: intervalo mínimo de 5 h entre corridas (mucho más que la hora exigida), `User-Agent` identificable, "Jobicy" y link canónico en cada aviso que se muestre.

## Verificado contra la fuente real (R1-8)
- Nombres de campos confirmados: `id`, `url`, `jobTitle`, `companyName`, `jobIndustry` (array de strings), `jobType` (array de strings), `jobGeo` (string), `jobLevel` (string), `jobDescription` (HTML string), `pubDate` (string ISO), `salaryCurrency` (string, en ~46% de los avisos).
- Sueldos: la API v2 actual usa `salaryMin`, `salaryMax`, `salaryPeriod` y `salaryCurrency`. `annualSalaryMin/Max` no viene en las respuestas actuales.
- Consultas por industria (`legal`, `accounting-finance`, `marketing`, `copywriting`, `management`, `project-management`, `business`, `admin-support`) y `geo=latam` devuelven HTTP 200 y traen puestos de dichas áreas.
- Deduplicación por `id`: combina categorías de la fuente (p. ej. `legal-compliance`, `finance-accounting`, `sales`, etc.) para nutrir `role_hints`.

## Cómo prenderla
El pool no consulta nada hasta que Mauro define `POOL_SOURCES` (las recomendadas son `getonboard,remoteok,jobicy`; se prenden de a una). Para apagarla, sacar `jobicy` de la variable. **Antes de prenderla**, correr `pnpm pool:fetch jobicy --dry-run`: informa avisos vistos, mapeados y salteados, y qué campos trae la respuesta real (solo conteos y tipos, nunca valores). No escribe en ninguna base.
