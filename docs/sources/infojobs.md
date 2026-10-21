# Fuente: InfoJobs (España) · NO integrada

Ficha de la ronda 103 (informe de fuentes en español, 2026-10-21). **Todavía no hay adapter.** No se integra sin el OK de Mauro y sin leer antes las condiciones de uso de la API. No es asesoramiento legal.

## Qué ofrece
Bolsa generalista de España con mucho volumen: tecnología, ventas, atención al cliente, RRHH y administración. Los avisos están en español.

## Cómo se integraría: API REST oficial
- **Acceso:** hay que registrar una app en el portal de desarrolladores de InfoJobs, que da un Client ID y un Secret. Las llamadas van con autenticación Basic.
- **Endpoint de ofertas:** `GET https://api.infojobs.net/api/9/offer`, con parámetros `q`, `province`, `category`, `teleworking`, `sinceDate`, `page` y `maxResults`.
  - **A verificar:** los nombres y los valores exactos, la paginación y si el listado trae la descripción completa o hay que pedir el detalle de cada aviso.
- **Rate limit:** no está publicado. **A verificar**, y respetar el retroceso ante 429.
- Encaja en el pool como una fuente más (ADR-014), con ventana por `sinceDate`, `User-Agent` identificable y tope de páginas.

## Términos
Las condiciones de uso de la API no se pudieron leer (404 el 2026-10-21). **Antes de integrar hay que leer** qué permiten sobre almacenar y mostrar avisos, sobre atribución y sobre uso comercial.

## Recomendación
1. Mauro registra la app y lee las condiciones.
2. Si permiten el uso, un `--dry-run` primero (como `pnpm pool:fetch <fuente> --dry-run`). Después, el alta detrás de `POOL_SOURCES`.
3. `countriesAllowed`: los avisos de InfoJobs son de España. Si la persona no es de España y el aviso no es remoto, el prefiltro lo tiene que tratar como riesgo de ubicación.
