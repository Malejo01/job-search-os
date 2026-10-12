# Fuente: Get on Board (API pública v0)

Hallazgos confirmados con llamadas reales el 2026-09-10 (JS-012). El adapter vive en `packages/adapters/src/sources/getonboard.ts`; el fixture de contrato en `__fixtures__/getonboard-search-page.json`.

## Endpoints

| Endpoint | Sirve para | Notas |
|---|---|---|
| `GET /api/v0/categories` | slugs de categorías | Usamos `programming`, `machine-learning-ai`, `data-science-analytics` (310, 34 y 113 avisos activos ese día). |
| `GET /api/v0/categories/<slug>/jobs?per_page=100&page=N&expand=[...]` | **el que usamos** | Ordenado por `published_at` desc, así se corta cuando una página entera es más vieja que la ventana. |
| `GET /api/v0/search/jobs?remote=true` | búsqueda | `remote=true` funciona acá, pero **`category` se ignora** (devuelve todas las categorías) y `query=` vacío devuelve 0. No sirve para ingestar por categoría. |
| `GET /api/v0/jobs/<id>` | detalle | **401 sin auth.** No hace falta: las listas ya traen la descripción completa. |
| `GET /api/v0/modalities`, `/seniorities` | catálogos | Modalidad: 1 Full time, 2 Part time, 3 Freelance, 4 Práctica. Seniority: 1 Sin experiencia, 2 Junior, 3 Semi Senior, 4 Senior, 5 Expert. |
| `GET /api/v0/tags?per_page=N` | tags | 1951 páginas; no se consulta. Con `expand` vienen los nombres inline. |
| `/location_tenants`, `/tenants` | — | Devuelven HTML: no existen como API. Los tenants vienen con `expand`. |

Sin API key. Sin rate limit observado en 6 páginas seguidas.

## Parámetros que NO hacen lo que parece

- `remote=true` en `/categories/<slug>/jobs`: ignorado (misma cantidad de páginas con y sin).
- `category=<slug>` en `/search/jobs`: ignorado.
- `published_at_from=<epoch>`: ignorado en todos los endpoints.

Por eso remoto y fecha se filtran en cliente (`fetchGetOnBoardJobs`).

## `expand`

`expand=["company","tags","modality","seniority","location_tenants"]` (URL-encoded) trae todo inline dentro de `attributes`:

- `company.data.attributes`: `name`, `description`, `web`, `country`, `logo`, `response_time_in_days`.
- `tags.data[].attributes.name`: nombres legibles ("Angular", "TypeScript", "RxJS"). Insumo de skills en fase 2.
- `modality.data.attributes.name`, `seniority.data.attributes.name`.
- `location_tenants.data[]`: `{ id: "peru", attributes: { name: "Peru" } }`. Es la lista de países del aviso cuando `remote_modality = remote_local` (caso Empresa F: Perú, Argentina, Chile, México, Colombia).

## Campos relevantes de un aviso

| Campo | Qué es | Cómo se mapea a `RawJob` |
|---|---|---|
| `id` | slug del aviso | `source.externalId`; `links.public_url` → `source.url` |
| `title` | título | `title` |
| `description_headline` / `description`, `functions_headline` / `functions`, `desirable_headline` / `desirable`, `benefits_headline` / `benefits` | HTML | `jdText` en texto plano (funciones, requisitos, deseables, beneficios). `projects` (empresa) no entra. |
| `remote` | boolean | filtro en cliente |
| `remote_modality` | `fully_remote` · `remote_local` · `temporarily_remote` · `hybrid` · `no_remote` | `modality`: remoto / remoto / remoto / hibrido / presencial |
| `countries` | `["Remote"]` si es remoto; país/es si no | híbrido/presencial → `countriesAllowed` (ISO-2) |
| `location_tenants` | países del aviso para `remote_local` | `countriesAllowed` (ISO-2); `fully_remote` → `["*"]`; `remote_local` sin tenants → `null` (riesgo) |
| `remote_zone` | casi siempre `null` | se agrega a `locationRaw` si viene |
| `min_salary` / `max_salary` | **USD mensuales** (Empresa F 3600 = golden) | `salaryMinUsd/MaxUsd`, `salaryPeriod: "mensual"` |
| `published_at` | epoch en segundos | `postedAt` |
| `applications_count` | candidatos | `candidatesCount` |
| `lang` | `en` · `es` · `lang_not_specified` | `lang` (null si no especificado) |
| `category_name` | nombre de categoría | informativo |
| `perks`, `rejected_reasons`, `response_time_in_days` | — | no se usan |

Distribución observada en 60 avisos de programming: 20 híbridos Chile, 13 `remote_local`, 11 `fully_remote`, 8 `no_remote`, el resto híbridos en Perú, Colombia, México, Argentina, Guatemala.

## Pool global (JS-137)

La fuente también alimenta el pool global (`POOL_SOURCES`; apagada hasta que Mauro define la variable, y se prende de a una tras el `--dry-run`), además de la ingesta por usuario de abajo, que sigue igual hasta que la asignación desde el pool la reemplace.

- Categorías: `GOB_POOL_CATEGORIES` = `programming`, `mobile-developer`, `machine-learning-ai`, `data-science-analytics`, `design-ux`, `sysadmin-devops-qa`, `customer-support`, más las carreras digitales de la ronda 40 (ADR-015): `digital-marketing`, `hr`, `innovation-agile`, `technical-support`, `cybersecurity`. Los tres de `GOB_CATEGORIES` están verificados (2026-09-10) y las cinco digitales también, en `/api/v0/categories` (2026-10-12); **`mobile-developer`, `design-ux`, `sysadmin-devops-qa` y `customer-support` están a verificar** con `pnpm pool:fetch getonboard --dry-run`. No se suman a propósito `sales`, `education-coaching`, `advertising-media`, `operations-management`, `other` ni `hardware-electronics`. `GOB_CATEGORIES` no cambia.
- Backfill de categorías nuevas: `since` sale de la última corrida ok de la fuente, así que una categoría recién sumada solo traería el último día. Después de sumar categorías se reinicia la bitácora de la fuente (lo hace Mauro) para que vuelva a hacer backfill; el dedup del pool absorbe lo repetido.
- Llamada con `remoteOnly: false` (el pool guarda también híbridos y presenciales), `skipMissingCategories: true` (un 404 en la página 1 de una categoría se saltea y queda en `missingCategories`; cualquier otro error corta) y ventana de 48 h.
- `RawJob.categories` = slugs de las categorías donde apareció el aviso; si aparece en otra, se **suma**.
- `partialOnError: true`: si una request falla (timeout incluido) después de haber juntado avisos, deja de pedir y devuelve lo juntado con `partial: true` y un código de error cerrado; el pool marca la fuente `partial`. Timeout de la fuente en el pool: 25 s.
- `User-Agent` identificable (`sourceUserAgent()`).
- `externalId` es el `id` de la fuente, ya sin prefijo.
- `--dry-run`: `pnpm pool:fetch getonboard --dry-run` informa páginas, avisos vistos, mapeados, categorías faltantes y qué campos trae la respuesta real (solo conteos y tipos, nunca valores). No escribe en ninguna base.

### Atribución y términos
Fuente: `ops/rondas/37-38-39/informes/riesgos-fuentes.md` §1 (consultado el 2026-10-12; no es asesoramiento legal). Es la fuente menos clara: la ayuda oficial invita a mostrar avisos en otro sitio, pero los Términos (sección 7) prohíben la descarga automática de su propiedad intelectual y entrenar modelos, y no publican límites ni atribución. Condiciones sugeridas: mostrar "Get on Board" y el link a `links.public_url`; consulta moderada con `User-Agent` identificable y retroceso ante 429; confirmación escrita del uso previsto (la decide y hace Mauro).

## Ingesta

- Ventana: 24 h en el cron (`/api/cron/ingest-getonboard`, `CRON_SECRET`), configurable en el CLI: `pnpm ingest:getonboard [--local] [--since-hours N] [--user <uuid>]`.
- Corte temprano por página; tope de 10 páginas por categoría; dedup por `id` entre categorías.
- Cada aviso pasa por `ingestRawJob`: dedup (14 días) → merge o insert → prefiltro → estado → cola `evaluate_job` si tiene JD.
- Segunda corrida el mismo día: 0 insertados, todos fusionados (misma `canonical_url` / `getonboard_api:<id>`).
