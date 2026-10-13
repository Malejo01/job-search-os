# Fuente: Lever (boards públicos)

Adapter: `packages/adapters/src/sources/lever.ts` (+ `ats-common.ts`). Estado: **pool global (ronda 47)**, **apagada hasta definir `POOL_SOURCES`** y hasta que haya boards en `ats_boards`. Formato **a verificar**: sale de la documentación pública, sin llamada real (sin red en la ronda).

## Endpoint
`GET https://api.lever.co/v0/postings/{token}?mode=json` → array de avisos. Para boards de la región europea (`region = 'eu'` en `ats_boards`): `https://api.eu.lever.co/v0/postings/{token}?mode=json`. Cualquier otra región es un error antes de la request. Sin credenciales. Una request por board, en serie, hasta 8 s por request, un reintento ante 429 o 5xx (`Retry-After` hasta 10 s, sin dormir si no entra en lo que le queda a la fuente) y tope de 15 MB en bytes. Sin redirecciones.

## Mapeo
| Lever | RawJob | Nota |
|---|---|---|
| `id` | `source.externalId = lever:{token}:{id}` | |
| `hostedUrl` | `source.url` | solo http(s) |
| `text` | `title` | |
| `company_name` del board | `companyRaw` | |
| `categories.location` | `locationRaw` | `countriesAllowed: null` salvo "Anywhere"/"Worldwide" |
| `workplaceType` | `modality` | `remote` → remoto, `hybrid` → híbrido, `on-site` → presencial, `unspecified` → según la ubicación |
| `categories.commitment` | `contractType` | |
| `categories.team` | `categories` | |
| `createdAt` (ms) | `postedAt` | lo anterior a `since` se descarta |
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

Informa estado del board, vistos, filtrados por no remoto, salteados y campos presentes (solo conteos y tipos). Un board inexistente da `not_found`. Ventana de 14 días; no escribe en la base.

## A verificar contra la fuente real
- Valores reales de `interval` en `salaryRange` (hoy se reconoce año, mes y hora por el texto).
- Que `workplaceType` venga siempre; si no, se usa la ubicación.
- Si hay boards europeos: confirmar el host `api.eu.lever.co`.
