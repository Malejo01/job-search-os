# Fuente: Teamtailor (feed RSS por sitio de empleo) · integrada, apagada

Adapter: `packages/adapters/src/sources/teamtailor.ts` (+ `ats-common.ts`). Ronda 120. Estado: **integrada, apagada**. No está en `POOL_RECOMMENDED_SOURCES`: la prende Mauro con `POOL_SOURCES`, después del `--dry-run` y de cargar boards con `enabled = false`. Necesita la migración 0041 de 120-b, que aplica Mauro (ver «Hecho en 120-b»). No es asesoramiento legal.

## Qué ofrece
Teamtailor es un ATS muy usado por empresas de Europa (España incluida) y de LatAm. Cada empresa tiene su propio sitio de empleo y no hay un listado global: igual que Greenhouse, Lever y Ashby (ADR-018), se trabaja con una **lista curada de empresas** en `ats_boards`.

## Endpoint y formato verificado
- `GET https://<token>.teamtailor.com/jobs.rss`. Para boards norteamericanos (`region = 'na'`): `https://<token>.na.teamtailor.com/jobs.rss`. Cualquier otra región es un error antes de la request (`na` solo vale para Teamtailor y `eu` solo para Lever).
- El token va en un subdominio: además de `isValidAtsToken` tiene que ser una etiqueta DNS válida (solo `[a-z0-9-]`, sin `.` ni `_`, sin guion al principio ni al final, máx. 63). Si no, `invalid_token` sin llegar a la red.
- RSS 2.0 con `xmlns:tt`. Un único XML, de 100 a 650 KB. Cada `<item>` trae `title`, `description` (HTML con entidades escapadas), `pubDate` (RFC 822), `link` (`https://<host>/jobs/<id>-<slug>`), `guid`, `remoteStatus` (`fully` | `hybrid` | `onsite` | `none`, sin namespace), `tt:locations` (0 a N `tt:location` con `tt:name`, `tt:address`, `tt:zip`, `tt:city`, `tt:country`), `tt:department`, `tt:role` y `tt:division`.
- **Un solo GET por board y por corrida**, sin `offset` ni `per_page`: es lo menos invasivo. El feed trae 100 avisos por defecto; si llegan **exactamente 100**, el resultado marca `feedMaybeTruncated` (el `--dry-run` lo imprime y el log del pool lo incluye como `feed_maybe_truncated`), pero no se piden más.
- Mismo cliente HTTP que los demás ATS: `User-Agent` identificable, sin login, 8 s por request, un reintento ante 429 o 5xx (respeta `Retry-After` hasta 10 s), tope de 15 MB en bytes, sin redirecciones. 404 → `not_found`.

## Mapeo
| Teamtailor | RawJob | Nota |
|---|---|---|
| `guid` (o el número de `/jobs/<id>-<slug>` del `link`) | `source.externalId = teamtailor:{token}:{id}` | sin id, título o link http(s) válido el item se saltea (falla cerrado por item) |
| `link` | `source.url` | solo http(s) |
| `title` | `title` | |
| `company_name` del board | `companyRaw` | |
| `tt:locations` | `locationRaw` | cada ubicación es `city, country` (o `name`); se unen con `"; "`. Sin ubicaciones: `null`. Un `country` no ISO como "LATAM" se guarda como texto |
| (no lo dice el feed) | `countriesAllowed` | `null` siempre, para que el prefiltro marque riesgo de ubicación |
| `remoteStatus` | `modality` | `fully` → remoto, `hybrid` → híbrido, `onsite` → presencial, `none` o ausente → desconocida. **`none` nunca es remoto** |
| `pubDate` | `postedAt` | |
| `tt:department`, `tt:role` | `categories` | los vacíos no suman |
| `description` | `jdText` | se decodifican las entidades y se pasa a texto plano |
| (el feed no trae salario) | `salary*` | todo `null` |

Filtro de remotos (`isPoolRemoteCandidate`): `fully` pasa; `hybrid` y `onsite` se descartan (`filteredNonRemote`); `none` o ausente se decide por la ubicación (sin ubicación se guarda).

## Condiciones de uso (ronda 120, resumen del informe de riesgos del 21/10)
Veredicto: **encaja con condiciones**, prioridad media. Los términos de Teamtailor son un contrato con sus clientes y no traen cláusula sobre bots ni scraping; la ayuda oficial describe `/jobs.rss` como datos públicos para otros canales de difusión. Verificar a mano antes de prender.
1. Solo `/jobs.rss`. Sin HTML.
2. `User-Agent` identificable, sin login.
3. Una request por board y por corrida, en serie, con la cadencia de ADR-018 (5 h) o más espaciada. Se respeta 429 y `Retry-After`.
4. Atribución y link al aviso original: «Publicado en el sitio de empleos de {empresa}».
5. Lista curada. **Antes de cargar un board hay que revisar el `robots.txt` del dominio de careers de esa empresa** (el de `www.teamtailor.com` permite todo; el de cada dominio no está verificado).
6. La descripción se muestra solo mientras el aviso siga abierto.
7. `--dry-run` antes de prenderla, para confirmar los campos reales.

## Cómo probar y cargar un board
Probar antes, sin tocar la base (hace UNA request al feed):

```
pnpm pool:fetch teamtailor empresa-ficticia [--region na] --company "Empresa Ficticia 1" --dry-run
```

Informa estado del board, vistos, filtrados por no remoto, salteados, el aviso de 100 items y la presencia de campos (solo conteos y tipos; nunca títulos, empresas ni URLs). Recontar con este parser: los conteos de la ronda 120 salieron de un modelo chico que trunca los feeds grandes.

Cargar el board **apagado**, y prenderlo recién después de revisar el `robots.txt`:

```sql
INSERT INTO ats_boards (provider, token, region, company_name, enabled)
VALUES ('teamtailor', 'empresa-ficticia', NULL, 'Empresa Ficticia 1', false)
ON CONFLICT (provider, token) DO NOTHING;
```

## Hecho en 120-b (migración 0041, la aplica Mauro)
- La migración 0041 amplía `ats_boards_provider_check` (agrega `teamtailor`) y `ats_boards_region_check` (agrega `na` solo para teamtailor), y agrega el valor `teamtailor` al enum `source_kind`. **Requiere aplicación en Neon por Mauro.**
- `POOL_SOURCE_KIND.teamtailor` y el `kind` de sus avisos pasan a `"teamtailor"`; se suma la atribución («Sitio de empleos» con el nombre de la empresa) y los rótulos «Teamtailor».
- La fuente sigue **apagada** hasta que Mauro aplique la migración y prenda los boards.
