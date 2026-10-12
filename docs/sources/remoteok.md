# Fuente: Remote OK

Adapter: `packages/adapters/src/sources/remoteok.ts`. Estado: **pool global (JS-137)**, **apagada hasta definir `POOL_SOURCES`** (recomendada, de a una y tras el `--dry-run`). Devuelve `kind: "remoteok"` y `externalId` = id de la fuente **sin prefijo**.

> Escrito sin red (ronda 07). Lo de este documento sale del formato documentado conocido y está **a verificar** con `pnpm pool:fetch remoteok --dry-run`.

## Endpoint
`GET https://remoteok.com/api` → array JSON, una sola llamada, con `User-Agent` identificable (`sourceUserAgent()`). Filtros de fecha y tags en cliente (`fetchRemoteOkJobs({ since, tags?, userAgent?, fetchImpl, baseUrl })`). El resultado incluye `legal`: el texto del campo `legal` del elemento `[0]` (no se guarda; el `--dry-run` informa si vino y su largo).

## Mapeo campo por campo
| Fuente | RawJob | Nota |
|---|---|---|
| elemento `[0]` (aviso legal, sin `id`/`position`) | descartado; su `legal` va a `FetchRemoteOkResult.legal` | a verificar que siga siendo el primero |
| `id` | `source.externalId` = `String(id)` | sin prefijo; puede venir string o número |
| `url` (o `apply_url`) | `source.url` | |
| `position` | `title` | |
| `company` | `companyRaw` | vacío → `desconocida` |
| `location` | `locationRaw` = `Remoto (<texto>)` | vacío → `Remoto (países no especificados)` |
| `location` "Worldwide"/"Anywhere" | `countriesAllowed: ["*"]` | cualquier otro texto ("USA", "Europe") → `null` |
| (toda la fuente) | `modality: "remoto"` | |
| `salary_min` / `salary_max` | `salaryMinUsd` / `salaryMaxUsd` | 0 → `null`; periodo `anual` si hay alguno |
| `description` (HTML) | `jdText` | `htmlToText` |
| `epoch` (s) o `date` | `postedAt` | el filtro por `since` usa `epoch` |
| `tags` | `tags` y `categories` (en minúsculas) | |
| aviso entero | `source.original` | JSON tal cual |

Quedan `null`: contrato, seniority, idioma, candidatos.

## Atribución exigida
Texto del campo `legal` del primer objeto de la API, citado en `ops/rondas/37-38-39/informes/riesgos-fuentes.md` §2 (consultado el 2026-10-12):
- "Please link back (with follow, and without nofollow!) to the URL on Remote OK and mention Remote OK as a source".
- "Please don't use the Remote OK logo without written permission as it's a registered trademark".

Cumplimiento: link a `source.url` **con `follow`** y mención visible "Remote OK" en cada aviso; **sin logo**. Rate limit: no figura; `remoteok.com/terms` devolvió 404. Una consulta por ciclo (intervalo mínimo de 5 h). La respuesta pesa ~586 K caracteres.

## A verificar contra la fuente real
- Que el primer elemento siga siendo el aviso legal y que traiga `legal`.
- Nombres exactos de campos y que `salary_*` sean USD anuales.
- Valores reales de `location` (hay textos compuestos tipo "USA, Canada" que quedan con `countriesAllowed: null`).
- Que `epoch` esté en segundos y presente en todos los avisos.
- Si exige cabecera `User-Agent` o limita la frecuencia.

## Cómo prenderla
El pool no consulta nada hasta que Mauro define `POOL_SOURCES` (las recomendadas son `getonboard,remoteok,jobicy`; se prenden de a una). Primero `pnpm pool:fetch remoteok --dry-run`: avisos vistos, mapeados, salteados, si vino el texto legal (sí/no y largo) y qué campos trae la respuesta real. Mirar:
- Formato real contra lo marcado "a verificar".
- Cantidad razonable para 48 h (ni cero ni miles).
- Salario: que sea USD anual antes de confiar en el filtro de piso.
