# Fuente: Ashby (boards públicos)

Adapter: `packages/adapters/src/sources/ashby.ts` (+ `ats-common.ts`). Estado: **pool global (ronda 47)**, **apagada hasta definir `POOL_SOURCES`** y hasta que haya boards en `ats_boards`. Formato **a verificar**: sale de la documentación pública, sin llamada real (sin red en la ronda).

## Endpoint
`GET https://api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=true` → `{ jobs: [...] }`. Sin credenciales. Una request por board, en serie, hasta 8 s por request, un reintento ante 429 o 5xx (`Retry-After` hasta 10 s, sin dormir si no entra en lo que le queda a la fuente) y tope de 15 MB en bytes. Sin redirecciones.

## Mapeo
| Ashby | RawJob | Nota |
|---|---|---|
| `isListed === false` | se descarta | se cuenta aparte como "no listados" |
| `id` (si no, el último tramo de `jobUrl`) | `source.externalId = ashby:{token}:{id}` | |
| `jobUrl` | `source.url` | solo http(s) |
| `title` | `title` | |
| `company_name` del board | `companyRaw` | |
| `location` + `secondaryLocations` | `locationRaw` | unidas con `;`; `countriesAllowed: null` salvo "Anywhere"/"Worldwide" |
| `workplaceType` / `isRemote` | `modality` | Remote → remoto, Hybrid → híbrido, OnSite → presencial |
| `employmentType` | `contractType` | |
| `department`, `team` | `categories` | |
| `descriptionPlain` (si no, `descriptionHtml` por `htmlToText`) | `jdText` | |
| `publishedAt` | `postedAt` | sin ventana de fecha: se trae todo lo abierto, hasta 200 por board (los más recientes) |
| `compensation.summaryComponents[]` con `compensationType = Salary` | `salaryMinUsd/MaxUsd` + `salaryPeriod` | solo USD con intervalo claro (`1 YEAR`, `1 MONTH`, `1 HOUR`); si no, `salaryNote`; sin componentes, `compensationTierSummary` va a `salaryNote` (D-017) |

Filtro de remotos (`isPoolRemoteCandidate`): `workplaceType`, `isRemote` y la ubicación; híbrido y presencial explícitos se descartan (`filteredNonRemote`).

## Condiciones de uso (a verificar)
Referencia: la documentación pública de la Job Postings API (https://developers.ashbyhq.com/docs/public-job-posting-api), que describe el endpoint sin autenticación para mostrar los avisos de una empresa. **No se leyeron los términos en esta ronda (sin red)**: Mauro los revisa antes de prender la fuente. Uso previsto: consulta cada 5 h, `User-Agent` identificable y enlace al aviso original.

## Atribución
"Publicado en el sitio de empleos de {empresa}", con el enlace al aviso original.

## Cómo cargar un board
```sql
INSERT INTO ats_boards (provider, token, company_name)
VALUES ('ashby', 'empresa-ficticia', 'Empresa Ficticia 3')
ON CONFLICT (provider, token) DO NOTHING;
```

Probar antes, sin tocar la tabla:

```
pnpm pool:fetch ashby empresa-ficticia --company "Empresa Ficticia 3" --dry-run
```

Informa estado, vistos, filtrados por no remoto, no listados, salteados y campos presentes (solo conteos y tipos). Sin ventana de fecha: se trae todo lo abierto en cada corrida, hasta 200 por board (los más recientes; el informe cuenta los recortados); la retención de 30 días cuenta desde la última vez que la fuente lo devolvió. No escribe en la base.

## A verificar contra la fuente real
- Que el id del aviso venga en `id` o, si no, que el final de `jobUrl` sea estable.
- Formato real de `interval` y de `compensationType` en `summaryComponents`.
- Forma de `secondaryLocations` (objetos con `location` o strings; el mapper acepta las dos).
