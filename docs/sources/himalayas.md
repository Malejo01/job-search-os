# Himalayas

Adapter: `packages/adapters/src/sources/himalayas.ts`. Estado: **apagada por sus términos**. Está en el enum y en la lista de fuentes del pool (`POOL_SOURCES`), pero **no** entre las recomendadas (`getonboard,remoteok,jobicy`): solo corre si alguien la agrega a `POOL_SOURCES` a mano. Sin esa variable el pool no consulta ninguna fuente. Devuelve `kind: "himalayas"` y `externalId` = `guid` **sin prefijo**.

**Todo el formato está sin verificar**: se armó desde la documentación conocida, sin llamada real (ronda 07, sin red).

## Endpoint
`GET https://himalayas.app/jobs/api?limit=N&offset=M` → `{ jobs, totalCount, offset, limit }`. Sin key. Con `User-Agent` identificable (`sourceUserAgent()`).

Su documentación (https://himalayas.app/docs/remote-jobs-api, consultada el 2026-10-12) marca `offset` como **deprecado** y prefiere `cursor` (y dice no construir ni interpretar cursores); `limit` por defecto y máximo 20. Hoy se sigue paginando por `offset`; pasar a `cursor` está **a verificar** con el `--dry-run`, porque el formato de la respuesta con cursor no está confirmado.

## Mapeo
| Himalayas | RawJob |
|---|---|
| `guid` | `source.externalId` (sin prefijo; sin guid o sin `title`: se descarta y se cuenta en `skipped`) |
| `applicationLink` | `source.url` |
| `title`, `companyName` | `title`, `companyRaw` |
| (todo remoto) | `modality: "remoto"` |
| `locationRestrictions` con nombres | `countriesAllowed` en ISO vía `countryToIso`; `locationRaw: "Remoto (...)"` |
| `locationRestrictions` vacío | `countriesAllowed: null`, `locationRaw: "Remoto (sin restricción de país indicada)"` (no se asume worldwide) |
| "Worldwide"/"Anywhere"/"Global" explícito | `["*"]` |
| nombre no mapeable (ej. una región como "Europe") | `countriesAllowed: null`; la región queda en `locationRaw` |
| `minSalary`/`maxSalary` y `currency` | solo `salaryNote` (ej. "USD <min>–<max>, período a verificar"); `salaryMinUsd/MaxUsd/Period` quedan en `null` hasta verificar el período (D-017) |
| `description` (HTML) | `jdText` vía `htmlToText` |
| `pubDate` (epoch s) | `postedAt` |
| `employmentType`, `seniority[]` | `contractType`, `seniority` (unido con coma) |
| `categories` | `tags` y `categories` |

`source.original` guarda el item tal cual.

## Términos: por qué está apagada
Fuente: `ops/rondas/37-38-39/informes/riesgos-fuentes.md` §4 (consultado el 2026-10-12 con un resumidor automático; no es asesoramiento legal).
- La API pide atribución: link visible a himalayas.app y mención de que los datos vienen de Himalayas. "The API data is cached and refreshed every 24 hours." 429 al exceder, sin cifra.
- Los Términos del sitio (https://himalayas.app/terms) prohíben "data mining, robots, screen scraping, or similar automated data gathering, extraction", copiar o redistribuir material del sitio y monetizar los datos sin consentimiento. No mencionan la API.
- **Veredicto del informe:** apta con condiciones solo si Himalayas o un abogado confirman que la API habilita lo que los Términos prohíben. Hasta entonces, no prenderla.
- Intervalo mínimo del pool: 23 h (una consulta por día).

## A verificar contra la fuente real
- Paginación por `cursor` (ver arriba) y el orden por fecha desc (el corte por `since` depende de eso).
- `pubDate`: segundos, milisegundos o ISO.
- **Condición para conectar la fuente:** verificar el período de `minSalary`/`maxSalary` (anual, mensual u otro) y recién entonces llenar `salaryMinUsd/MaxUsd/Period` para USD. También si `currency` viene siempre.
- Qué valores trae `locationRestrictions` (nombres en inglés, ISO, regiones, "Worldwide") y si `timezoneRestrictions` conviene usarlo.
- Que `guid` sea estable y único.
- Si hay JD completa en `description` o solo un resumen.

## Cómo prenderla
No hacerlo hasta resolver la duda de términos. Si se resuelve: agregar `himalayas` a `POOL_SOURCES` y antes correr `pnpm pool:fetch himalayas --dry-run` (descarga hasta 3 páginas, una vez; informa conteos y qué campos trae la respuesta real, nunca valores). Mirar `pubDate`, `guid`, `description`, `locationRestrictions` y el período del salario.
