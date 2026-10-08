# Himalayas

Adapter: `packages/adapters/src/sources/himalayas.ts`. Estado: **no conectado al cron** (falta la migración del enum `source_kind`; hoy devuelve `kind: "other"` y `externalId` con prefijo `himalayas:`).

**Todo el formato está sin verificar**: se armó desde la documentación conocida, sin llamada real (ronda 07, sin red).

## Endpoint
`GET https://himalayas.app/jobs/api?limit=N&offset=M` → `{ jobs, totalCount, offset, limit }`. Paginado por offset, más nuevos primero. Sin key.

## Mapeo
| Himalayas | RawJob |
|---|---|
| `guid` | `source.externalId = himalayas:<guid>` (sin guid o sin `title`: se descarta y se cuenta en `skipped`) |
| `applicationLink` | `source.url` |
| `title`, `companyName` | `title`, `companyRaw` |
| (todo remoto) | `modality: "remoto"` |
| `locationRestrictions` con nombres | `countriesAllowed` en ISO vía `countryToIso`; `locationRaw: "Remoto (...)"` |
| `locationRestrictions` vacío | `countriesAllowed: null`, `locationRaw: "Remoto (sin restricción de país indicada)"` (no se asume worldwide) |
| "Worldwide"/"Anywhere"/"Global" explícito | `["*"]` |
| nombre no mapeable (ej. una región como "Europe") | `countriesAllowed: null`; la región queda en `locationRaw` |
| `minSalary`/`maxSalary` y `currency` | solo `salaryNote` (ej. "USD <min>–<max>, período a verificar"); `salaryMinUsd/MaxUsd/Period` quedan en `null` hasta verificar el período, para no falsear el piso en `decide()` |
| `description` (HTML) | `jdText` vía `htmlToText` |
| `pubDate` (epoch s) | `postedAt` |
| `employmentType`, `seniority[]`, `categories` | `contractType`, `seniority` (unido con coma), `tags` |

`source.original` guarda el item tal cual.

## A verificar contra la fuente real
- Tope de `limit` por página (se usa 20) y si el orden es realmente por fecha desc (el corte por `since` depende de eso).
- `pubDate`: segundos, milisegundos o ISO.
- **Condición para conectar la fuente:** verificar el período de `minSalary`/`maxSalary` (anual, mensual u otro) y recién entonces llenar `salaryMinUsd/MaxUsd/Period` para USD. También si `currency` viene siempre.
- Qué valores trae `locationRestrictions` (nombres en inglés, ISO, regiones, "Worldwide") y si `timezoneRestrictions` conviene usarlo.
- Que `guid` sea estable y único (hoy se asume).
- Si hay JD completa en `description` o solo un resumen.

## Términos de uso: pendiente para riesgos
Revisar términos de la API pública (atribución exigida, frecuencia máxima, uso permitido de los datos). No se investigó: sin red.

## Cómo prenderla
Agregar `himalayas` a `INGEST_EXTRA_SOURCES` (docs/DEPLOY.md) **solo después** de verificar el período de `minSalary`/`maxSalary` y de revisar los términos de uso. En la primera corrida, mirar la respuesta del cron (`extraSources`) y los avisos ingeridos:
- Formato real contra lo marcado "a verificar": `pubDate`, `guid`, `description`.
- Cantidad: `fetched` razonable para 24 h (el cron pagina hasta 3 páginas).
- Ubicación: valores reales de `locationRestrictions` y su mapeo a `countriesAllowed`.
- Salario: moneda y período coherentes antes de confiar en el filtro de piso.
