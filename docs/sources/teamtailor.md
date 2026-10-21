# Fuente: Teamtailor (bolsas de empresas) · NO integrada

Ficha de la ronda 103 (informe de fuentes en español, 2026-10-21). **Todavía no hay adapter.** No se integra sin el OK de Mauro y sin leer los términos. No es asesoramiento legal.

## Qué ofrece
Teamtailor es un ATS muy usado por empresas de Europa (España incluida) y de LatAm. Cada empresa tiene su propio sitio de empleo. No hay un listado global: igual que Greenhouse, Lever y Ashby (ADR-018), se necesita una **lista curada de empresas**.

## Cómo se integraría: feed RSS público por sitio de empleo
- Cada sitio publica `https://<empresa>.teamtailor.com/jobs.rss` (o el dominio propio de la empresa), que figura en la ayuda oficial de Teamtailor.
- Trae 100 avisos por defecto y acepta `offset` y `per_page`. **A verificar:** qué campos trae el ítem (ubicación, modalidad, descripción completa o resumen).
- Encaja como un proveedor más de `ats_boards`: proveedor `teamtailor` y el token del sitio. Hace falta ampliar el check `ats_boards_provider_check` con una migración.
- Defensas como las de ADR-018: el token se valida y se codifica, se usa `User-Agent` identificable, el estado por board es cerrado y un board que falla no corta al resto.

## Términos
No se encontraron términos específicos sobre el feed. **Antes de integrar hay que leer** los términos generales de Teamtailor y confirmar que el feed se puede consumir y que los avisos se pueden mostrar con atribución y link al original.

## Recomendación
Integrar con una lista curada después de leer los términos, con prioridad media. El volumen depende de las empresas que se elijan.
