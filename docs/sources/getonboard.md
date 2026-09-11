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

## Ingesta

- Ventana: 24 h en el cron (`/api/cron/ingest-getonboard`, `CRON_SECRET`), configurable en el CLI: `pnpm ingest:getonboard [--local] [--since-hours N] [--user <uuid>]`.
- Corte temprano por página; tope de 10 páginas por categoría; dedup por `id` entre categorías.
- Cada aviso pasa por `ingestRawJob`: dedup (14 días) → merge o insert → prefiltro → estado → cola `evaluate_job` si tiene JD.
- Segunda corrida el mismo día: 0 insertados, todos fusionados (misma `canonical_url` / `getonboard_api:<id>`).
