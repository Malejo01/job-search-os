# Fuente: Greenhouse (boards públicos)

Adapter: `packages/adapters/src/sources/greenhouse.ts` (+ `ats-common.ts`). Estado: **pool global (ronda 47)**, **apagada hasta definir `POOL_SOURCES`** y hasta que haya boards en `ats_boards`. Formato **a verificar**: sale de la documentación pública, sin llamada real (sin red en la ronda).

## Endpoint
`GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` → `{ jobs: [...] }`. `{token}` es el slug del board de la empresa (el de `boards.greenhouse.io/{token}`). Sin credenciales. Una request por board, en serie, con hasta 8 s por request (menos si es lo que le queda a la fuente; el timeout corta también la lectura del cuerpo), un reintento ante 429 o 5xx (respeta `Retry-After` hasta 10 s, y si la espera no entra en lo que le queda a la fuente el board falla sin dormir) y **tope de 15 MB** por respuesta, contado en bytes mientras se lee el stream (con `content=true` un board grande supera los 5 MB).

El token se valida (`^[a-z0-9][a-z0-9._-]{0,99}$`, sin distinguir mayúsculas) y se codifica antes de armar la URL; el host es fijo. No se siguen redirecciones.

## Mapeo
| Greenhouse | RawJob | Nota |
|---|---|---|
| `id` | `source.externalId = greenhouse:{token}:{id}` | |
| `absolute_url` | `source.url` | solo http(s) |
| `title` | `title` | |
| `company_name` del board (`ats_boards`) | `companyRaw` | |
| `location.name` | `locationRaw` | `countriesAllowed: null` salvo "Anywhere"/"Worldwide" (`["*"]`) |
| `content` | `jdText` | viene con las etiquetas HTML escapadas (`&lt;p&gt;`): se decodifica y se pasa a texto |
| `first_published` (si no, `updated_at`) | `postedAt` | sin ventana de fecha: se trae todo lo abierto, hasta 200 por board (los más recientes; sin fecha van al final) |
| `departments[].name` | `categories` | el rol se infiere por título |
| (no trae) | sueldo `null`, `modality` solo `remoto` si la ubicación lo dice | D-017 |

Se guarda solo lo remoto (`isPoolRemoteCandidate`): "remote"/"remoto", LATAM, Argentina, Anywhere o Worldwide; lo híbrido o presencial explícito se descarta y se cuenta como `filteredNonRemote`. Ubicación vacía: se guarda.

## Condiciones de uso (a verificar)
Referencia: la documentación pública de la Job Board API (https://developers.greenhouse.io/job-board.html), que describe los GET sin autenticación como el medio para mostrar los avisos de una empresa. **No se leyeron los términos en esta ronda (sin red)**: Mauro los revisa antes de prender la fuente. El uso previsto es el que la API ofrece: consulta moderada (cada 5 h), `User-Agent` identificable y enlace al aviso original.

## Atribución
"Publicado en el sitio de empleos de {empresa}", con el enlace al aviso original (`source_url`). Los avisos son de la empresa, no de JSO.

## Cómo cargar un board
Sin boards no corre. Los carga Mauro con SQL (plantilla en `ops/rondas/47-fuentes-pool/sql/seed-ats.sql`):

```sql
INSERT INTO ats_boards (provider, token, company_name)
VALUES ('greenhouse', 'empresa-ficticia', 'Empresa Ficticia 1')
ON CONFLICT (provider, token) DO NOTHING;
```

Antes de cargarlo, probar el board sin tocar la tabla:

```
pnpm pool:fetch greenhouse empresa-ficticia --company "Empresa Ficticia 1" --dry-run
```

Informa estado del board (`ok` o `not_found`), vistos, filtrados por no remoto, salteados y qué campos trae la respuesta (solo conteos y tipos). Sin ventana de fecha: se trae todo lo abierto en cada corrida, hasta 200 por board (los más recientes; el informe cuenta los recortados); la retención de 30 días cuenta desde la última vez que la fuente lo devolvió. No escribe en ninguna base.

Para apagar un board: `UPDATE ats_boards SET enabled = false WHERE provider = 'greenhouse' AND token = '...'`. `last_status` guarda el último código cerrado (`ok`, `not_found`, `timeout`, `http_429`, `http_4xx`, `http_5xx`, `parse`, `too_large`).

## A verificar contra la fuente real
- Que `content=true` traiga el texto completo y vengan escapadas las etiquetas.
- Qué campo de fecha es más confiable (`first_published` vs `updated_at`).
- Tamaño de las respuestas de boards grandes (tope de 15 MB: pasarse da `too_large`).
