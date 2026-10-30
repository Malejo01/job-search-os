# Fuente: We Work Remotely (WWR)

Adapter: `packages/adapters/src/sources/wwr.ts`. Desde la ronda 47 es una **fuente del pool global** (`POOL_SOURCES=wwr`, ADR-014 y ADR-018), no de `INGEST_EXTRA_SOURCES`. Devuelve `kind: "wwr"`, `source.name` = `WWR <categoría>`, `externalId` = `wwr:<guid>` y `categories: [<slug de la categoría>]`.

> Escrito sin red. Todo lo de este documento sale del formato documentado conocido y está **a verificar** con `pool:fetch wwr --dry-run` antes de prender la fuente.

## Endpoint
`GET https://weworkremotely.com/categories/<categoría>.rss`, una llamada por categoría, en serie. Categorías del pool (`WWR_POOL_CATEGORIES`, 11 categorías verificadas con `pnpm pool:fetch wwr --dry-run` sin errores HTTP 404):

| Slug | Rol que sugiere (`role_hints`) |
|---|---|
| `remote-programming-jobs` | frontend, backend, fullstack |
| `remote-full-stack-programming-jobs` | fullstack |
| `remote-back-end-programming-jobs` | backend |
| `remote-front-end-programming-jobs` | frontend |
| `remote-devops-sysadmin-jobs` | soporte_it |
| `remote-product-jobs` | product_manager, product_owner, project_manager (el título separa; `product_marketing` sale solo del título) |
| `remote-customer-support-jobs` | customer_success |
| `remote-design-jobs` | ux_ui |
| `remote-sales-and-marketing-jobs` | ventas_b2b, marketing |
| `remote-management-and-finance-jobs` | management, finanzas |
| `all-other-remote-jobs` | varias (catch-all) |

Filtro por fecha en cliente: `fetchWwrJobs({ since, categories?, userAgent?, partialOnError?, fetchImpl?, baseUrl? })`. Deduplica por `guid` (o `link`) entre categorías. Sin `partialOnError` el primer error corta; con `partialOnError` las categorías que fallan se saltean, se devuelve lo juntado con `partialError` (código cerrado) y solo tira si fallan todas. Intervalo de la fuente en el pool: 5 h.

## Parseo
Mínimo, con expresiones regulares sobre `<item>…</item>`, sin dependencias. Soporta CDATA (literal) y texto con entidades XML (se decodifican una vez; luego `htmlToText`). Falla cerrado **por item**: sin `title`, `link` o `pubDate` válido se saltea y se cuenta en `skipped`; nunca se inventan campos.

## Mapeo campo por campo
| Fuente | RawJob | Nota |
|---|---|---|
| `title` "Empresa: Puesto" | `companyRaw` / `title` | corta en el primer `:`; sin `:` → empresa `desconocida` y título entero |
| `guid` (o `link`) | `source.externalId` = `wwr:<guid>` | |
| `link` | `source.url` | |
| `region` "Anywhere in the World" | `locationRaw` = `Remoto (<región>)`, `countriesAllowed: ["*"]` | |
| `region` otro valor ("USA Only") | `locationRaw` = `Remoto (<región>)`, `countriesAllowed: null` | el prefiltro marca el riesgo |
| `region` ausente | `Remoto (países no especificados)`, `null` | |
| (toda la fuente) | `modality: "remoto"` | |
| `type` | `contractType` | |
| `category` | `tags: [categoría]` | |
| slug de la categoría consultada | `categories: [slug]` | alimenta el `role_hints` (`SOURCE_CATEGORY_ROLES.wwr`) |
| `description` | `jdText` | `htmlToText` |
| `pubDate` (RFC 822) | `postedAt` | |
| item entero | `source.original` | XML del `<item>` tal cual, `application/rss+xml` |

Quedan `null`: salario (el RSS no lo trae), seniority, idioma, candidatos.

## Atribución
«Publicado en We Work Remotely», con el link al aviso original (`source_url`). Sin logos. Texto en `SOURCE_ATTRIBUTION.wwr` (`packages/pipeline/src/pool/attribution.ts`).

## Verificación contra la fuente real (resultado `--dry-run`)
- **Slugs de categorías:** Las 11 categorías (`WWR_POOL_CATEGORIES`) devuelven HTTP 200 y RSS válido (0 con HTTP 404).
- **Campos crudos observados (508 items):**
  - `title`: 100% (corta en `:` o toma empresa desconocida).
  - `link`: 100%.
  - `guid`: 100%.
  - `pubDate`: 100% (RFC 822 válido).
  - `region`: 100% (e.g. "Anywhere in the World" mapea a `countriesAllowed: ["*"]`, "USA Only" a `countriesAllowed: null`).
  - `category`: 100%.
  - `type`: 95% (e.g. "Full-Time").
  - `description`: 100% (HTML plano y entidades escapadas decodificadas con `htmlToText`).
- **Resumen del dry-run:** 508 vistos, 45 mapeados en la ventana de 48 h, 35/45 con pista de puesto reconocida (`ventas_b2b`, `atencion_cliente`, `customer_success`, `fullstack`, `product_manager`, etc.).
- **Timeout recomendado:** 20 s en `DEFAULT_TIMEOUT_MS.wwr` para tolerar las 11 llamadas secuenciales con margen.

## Términos de uso (pendiente para riesgos)
- Atribución y uso permitido del feed: revisar antes de prender.
- Frecuencia de consulta recomendada (el pool consulta cada 5 h).

## Cómo prenderla
1. `pnpm pool:fetch wwr --dry-run` (sin escribir en la base): revisar el informe de campos mapeados y los slugs que den 404.
2. Sumar `wwr` a `POOL_SOURCES` (docs/DEPLOY.md). Está en `POOL_RECOMMENDED_SOURCES` para prenderla de a una.
3. `wwr` ya **no** va en `INGEST_EXTRA_SOURCES`: si quedó ahí se ignora con un aviso en el log («wwr pasó al pool: sumala a POOL_SOURCES») y no rompe nada.
