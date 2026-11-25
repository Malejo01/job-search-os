# ADR-046: Recruitee y SmartRecruiters como fuentes del pool (adaptadores apagados)

**Status:** Accepted · **Date:** 2026-11-25 · **Amplía:** ADR-018 (ATS públicos), ADR-024 · **Relacionada:** ADR-004

## Context
- Las carreras no técnicas de la beta (abogacía, contaduría, administración, comunicación, RR.HH.,
  marketing, atención al cliente) publican muy poco en Greenhouse, Lever y Ashby. Recruitee y
  SmartRecruiters son ATS que muchas empresas usan para su propia página de empleos.
- Reglas del proyecto: solo APIs **públicas** que la empresa expone para su sitio de empleos, nunca
  scraping de portales (ADR-004, ADR-024), con interruptor, User-Agent propio, tope de pedidos y
  atribución con link al aviso original.
- **Nada de lo que sigue sobre el formato de las respuestas se probó contra la API real**: los tests usan
  fixtures inventadas. Cada adaptador lo dice en su cabecera («formato a verificar con
  `pnpm pool:fetch <proveedor> <token> --dry-run`»).

## Verificación de que la API es pública (25/11/2026)
| Proveedor | API | Documentación oficial |
|---|---|---|
| Recruitee | Careers Site API, `GET https://<empresa>.recruitee.com/api/offers/` | https://docs.recruitee.com/reference/offers · https://docs.recruitee.com/reference/authentication-1 |
| SmartRecruiters | Posting API, `GET https://api.smartrecruiters.com/v1/companies/<id>/postings` (paginada con `limit` hasta 100 y `offset`; el detalle de cada aviso es otro pedido) | https://developers.smartrecruiters.com/docs/posting-api · https://developers.smartrecruiters.com/docs/customer-overview |

- **Recruitee:** hoy responde sin clave. La documentación oficial indica que **desde el 10/02/2027** hace
  falta el header `X-Careers-Sites-Token`, un token que genera cada empresa en su cuenta.
- **SmartRecruiters:** la documentación del cliente dice que el Posting API se llama sin autenticación.
  Solo aparecen los avisos que la empresa hizo públicos.
- Esta verificación la hizo el lead con búsqueda web; el guard del equipo no deja abrir esos dominios.
  El dueño del proyecto puede confirmar con los comandos de los pasos manuales de la tanda.

## Decision
1. **Dos fuentes nuevas del pool** (`recruitee`, `smartrecruiters`), mismas reglas que Teamtailor y
   Workable: los boards salen de `ats_boards` (migración 0083: dos valores nuevos de `source_kind` y el
   check `ats_boards_provider_check`), **apagadas por defecto** (solo corren si están en `POOL_SOURCES`),
   fuera de `POOL_RECOMMENDED_SOURCES`, intervalo mínimo de 5 h, timeout por pedido y por fuente, y
   `User-Agent` de `sourceUserAgent()`. Sin redirecciones (`redirect: "error"`).
2. **Token:** Recruitee lo usa de subdominio (etiqueta DNS estricta, igual que Teamtailor y Workable);
   SmartRecruiters como id de empresa en la ruta (`[A-Za-z0-9._-]`, sin `..`). Sin región en ninguno.
3. **Atribución:** igual que los demás ATS («Sitio de empleos de {empresa}») y link al aviso original, que
   tiene que quedar en `recruitee.com` o `smartrecruiters.com` (una respuesta hostil no puede mandar el
   «postular» a otro sitio).
4. **Remoto solo si se declara** (`remote === true` en Recruitee, `location.remote === true` en
   SmartRecruiters). Sin ese dato el aviso no entra como remoto y el texto de la ubicación no lo cambia.
   `countriesAllowed` es siempre `null` (el prefiltro marca el riesgo de ubicación).
5. **Recruitee, 401 o 403:** falla cerrado con `http_4xx`, un solo pedido, sin ofertas parciales. **El
   token de la empresa (`X-Careers-Sites-Token`) NO se implementa ahora.** Después del 10/02/2027 el
   adaptador solo servirá para boards cuya empresa entregue ese token; hasta entonces responde sin él.
   Si hace falta, se abre un ADR nuevo que agregue la columna del token cifrado.
6. **SmartRecruiters, tope de pedidos:** por board y por corrida, como máximo `SMARTRECRUITERS_MAX_PAGES`
   (3) páginas de la lista y `SMARTRECRUITERS_MAX_DETAILS` (25) detalles: 28 pedidos. La lista no trae
   descripción ni link, así que solo se pide el detalle de los avisos que **declaran remoto**, los más
   recientes primero; el resto cuenta en `truncated`.
7. **Sin descripción no se ingesta.** Un detalle sin texto o sin `postingUrl` de smartrecruiters.com se
   saltea. No hay un estado «pendiente de JD» en el pool y no se inventa uno.
8. **Falla cerrado.** Forma inesperada de la lista → `parse`, board descartado. En SmartRecruiters, un
   detalle que falla por algo distinto de 404 (timeout, 429, 5xx, 401/403) corta el board entero sin avisos
   parciales; un 404 saltea solo ese aviso. Ids con caracteres de ruta no se piden.

## Consequences
- Más cobertura de carreras no técnicas con empresas que publican en su propio sitio, sin tocar portales.
- Costo bajo: Recruitee es un pedido por board; SmartRecruiters, hasta 28.
- Riesgo: el formato real puede diferir de lo asumido; el `--dry-run` lo muestra y los adaptadores caen
  cerrados. Antes de prender cualquiera: `pool:fetch <proveedor> <token> --dry-run` con un board real.
- Recruitee tiene fecha de vencimiento para el uso sin token (10/02/2027).
- La migración 0083 **la aplica en Neon el dueño del proyecto** (`ALTER TYPE ... ADD VALUE` y el check).
- Enchufes tocados: `ATS_PROVIDERS`, `POOL_SOURCE_NAMES` y tablas de `pool/fetch.ts`, `ATS_SOURCE_KINDS`
  y `ATS_KINDS` del pool, `SourceKind` y la atribución del pipeline, rótulos de la web.
