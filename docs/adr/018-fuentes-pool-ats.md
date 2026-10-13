# ADR-018: Fuentes al pool: WWR y ATS públicos; portales sin API, solo por email

**Status:** Accepted · **Date:** 2026-10-13

## Context
El pool global (ADR-014) tiene cuatro fuentes con API o feed y cubre sobre todo tecnología. Se
quiere sumar más avisos remotos, de más empresas y de más disciplinas, **sin subir el gasto**:
traer avisos no cuesta tokens, y las evaluaciones siguen acotadas por `pool_daily_eval_limit`.
Hay fuentes que no ofrecen un camino permitido: los portales sin API (Computrabajo, Bumeran) solo
se pueden scrapear, y Torre tiene su API oficial en beta privada.

## Decision
1. **We Work Remotely pasa al pool** (RSS por categoría, antes en `INGEST_EXTRA_SOURCES`) y
   se prende con `POOL_SOURCES`.
2. **Tres ATS públicos entran al pool con una lista curada de empresas:** Greenhouse, Lever y
   Ashby, cada uno con su API de lectura sin credenciales. La lista vive en la tabla `ats_boards`
   (proveedor, token, región, nombre, `enabled`, `last_fetch_at`, `last_status`); sin boards la
   fuente queda `skipped` con motivo `sin_boards`. Una fuente del pool por proveedor, con una
   request por board, en serie, y un board que falla no corta a los demás. Solo los fallos
   transitorios (timeout, 429, 5xx, red, `too_large`, parse) dejan la fuente `partial`, o `error`
   si fallaron todos; `not_found` e `invalid_token` quedan en `last_status` del board sin afectar a
   la fuente (un slug mal cargado no puede dejar al proveedor en backfill eterno) y ese board se
   reintenta una vez por día. Lo que no entra en el tiempo se retoma en la corrida siguiente por
   `last_fetch_at` ascendente. `last_fetch_at` se actualiza después del upsert. Dentro del pool,
   las fuentes corren por último intento ascendente (las nunca intentadas primero), así las del
   final de la lista no pasan hambre; el presupuesto del pool en el cron sube a 65 s
   (`maxDuration` de 120 s).
3. **Filtro previo sin LLM** (`isPoolRemoteCandidate`): un ATS publica todos los puestos de la
   empresa, así que solo se guarda lo remoto. Ante la duda se guarda y decide el prefiltro por
   usuario.
4. **Defensas de red:** el token del board se valida y se codifica (nunca se concatena crudo), el
   host y la única región (`eu` en Lever) salen de una tabla fija, sin redirecciones, hasta 8 s por
   request (la señal se combina con la de la fuente con `AbortSignal.any` y corta también la
   lectura del cuerpo; nunca pasa de lo que le queda a la fuente), tope de 15 MB por respuesta
   contado en bytes sobre el stream (Greenhouse con `content=true` pasa de 5 MB) y un reintento
   ante 429 o 5xx que no duerme si la espera (`Retry-After` hasta 10 s) no entra en lo que le
   queda a la fuente. El estado por board es un código cerrado, nunca el mensaje crudo.
5. **Atribución:** "Publicado en el sitio de empleos de {empresa}" para los ATS, con el enlace al
   aviso original; "Publicado en We Work Remotely" para WWR.
6. **Computrabajo y Bumeran: solo por alertas por email** (ronda 48), como LinkedIn (ADR-003,
   ADR-004). No hay scraping.
7. **Torre sigue apagado:** su API oficial está en beta privada, hay que pedir acceso; el adapter
   usa un endpoint no documentado y no se prende.
8. **Al backlog:** Jooble, Careerjet y Arbeitnow, para evaluar con sus términos.

## Consequences
- **La lista de empresas la mantiene Mauro con SQL.** Es un trabajo manual y el valor del pool de
  ATS depende de esa lista; a cambio no hay descubrimiento automático de boards ni scraping.
- Costo de red bajo: unas decenas de requests por corrida cada 5 h. El costo de LLM no cambia.
- Más avisos remotos pero con ruido (puestos que dicen "remote" con restricción de país): lo
  resuelve el prefiltro por usuario, no la descarga.
- Las condiciones de uso de cada ATS se citan por sus páginas públicas pero no se leyeron en la
  ronda (sin red): Mauro las revisa antes de prender cada fuente, de a una y tras el `--dry-run`
  (`pnpm pool:fetch <proveedor> <token> --dry-run`).
- Una migración (enum `source_kind` y tabla `ats_boards`, ronda 47) que aplica Mauro.
