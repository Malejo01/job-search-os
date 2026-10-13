# Fuente: Lever (boards públicos)

Adapter: `packages/adapters/src/sources/lever.ts` (+ `ats-common.ts`). Estado: **pool global (ronda 47)**, **apagada hasta definir `POOL_SOURCES`** y hasta que haya boards en `ats_boards`. Formato **a verificar**: sale de la documentación pública, sin llamada real (sin red en la ronda).

## Endpoint
`GET https://api.lever.co/v0/postings/{token}?mode=json&limit=200` (la API devuelve como máximo 200 avisos por pedido y no se pagina: alcanza con lo más reciente del board; sin `limit`, un board de más de mil avisos no entraba en los 8 s). **Pérdida conocida y aceptada:** el `limit` se aplica antes del filtro de remotos y la API no garantiza orden por fecha, así que los remotos que queden después del aviso 200 se pierden sin aviso. Si algún día hace falta, la alternativa es paginar con `skip` → array de avisos. Para boards de la región europea (`region = 'eu'` en `ats_boards`): `https://api.eu.lever.co/v0/postings/{token}?mode=json&limit=200`. Cualquier otra región es un error antes de la request. Sin credenciales. Una request por board, en serie, hasta 8 s por request, un reintento ante 429 o 5xx (`Retry-After` hasta 10 s, sin dormir si no entra en lo que le queda a la fuente) y tope de 15 MB en bytes. Sin redirecciones.

## Mapeo
| Lever | RawJob | Nota |
|---|---|---|
| `id` | `source.externalId = lever:{token}:{id}` | |
| `hostedUrl` | `source.url` | solo http(s) |
| `text` | `title` | |
| `company_name` del board | `companyRaw` | |
| `categories.location` + `categories.allLocations` | `locationRaw` | se unen sin repetidos con `"; "` (como Ashby) y alimentan el filtro de remotos; `countriesAllowed: null` salvo "Anywhere"/"Worldwide" |
| `workplaceType` | `modality` | `remote` → remoto, `hybrid` → híbrido, `on-site` → presencial, `unspecified` → según la ubicación |
| `categories.commitment` | `contractType` | |
| `categories.team` | `categories` | |
| `createdAt` (ms) | `postedAt` | sin ventana de fecha: se trae todo lo abierto, hasta 200 por board (los más recientes) |
| `descriptionPlain` + `lists[]` + `additionalPlain` | `jdText` | `lists[].content` es HTML y pasa por `htmlToText` |
| `salaryRange` (`min`, `max`, `currency`, `interval`) | `salaryMinUsd/MaxUsd` + `salaryPeriod` | solo USD con período claro (año, mes u hora); si no, `salaryNote` (D-017) |

Filtro de remotos (`isPoolRemoteCandidate`): `workplaceType` o la ubicación; híbrido y presencial explícitos se descartan (`filteredNonRemote`). Ubicación vacía: se guarda.

## Condiciones de uso (a verificar)
Referencia: la documentación pública de la Postings API (https://github.com/lever/postings-api), que describe el endpoint de lectura sin autenticación para publicar los avisos de una empresa. **No se leyeron los términos en esta ronda (sin red)**: Mauro los revisa antes de prender la fuente. Uso previsto: consulta cada 5 h, `User-Agent` identificable y enlace al aviso original.

## Atribución
"Publicado en el sitio de empleos de {empresa}", con el enlace al aviso original.

## Cómo cargar un board
```sql
INSERT INTO ats_boards (provider, token, region, company_name)
VALUES ('lever', 'empresa-ficticia', NULL, 'Empresa Ficticia 2')
ON CONFLICT (provider, token) DO NOTHING;
```

Probar antes, sin tocar la tabla:

```
pnpm pool:fetch lever empresa-ficticia [--region eu] --company "Empresa Ficticia 2" --dry-run
```

Informa estado del board, vistos, filtrados por no remoto, salteados y campos presentes (solo conteos y tipos). Un board inexistente da `not_found`. Sin ventana de fecha: se trae todo lo abierto en cada corrida, hasta 200 por board (los más recientes; el informe cuenta los recortados); la retención de 30 días cuenta desde la última vez que la fuente lo devolvió. No escribe en la base.

## A verificar contra la fuente real
- Valores reales de `interval` en `salaryRange` (hoy se reconoce año, mes y hora por el texto).
- Que `workplaceType` venga siempre; si no, se usa la ubicación.
- Si hay boards europeos: confirmar el host `api.eu.lever.co`.
