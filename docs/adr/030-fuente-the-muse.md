# ADR-030: The Muse como fuente del pool para las carreras no tech

**Status:** Proposed · **Date:** 2026-11-03 · Complementa ADR-014, ADR-018 y ADR-027. Ficha técnica: `docs/sources/themuse.md`.

## Context

- La beta cerrada (ADR-027) suma seis carreras no tech. Las fuentes con API del pool casi no traen ofertas de esas carreras para Argentina (`docs/sources/fuentes-no-tech.md`).
- The Muse publica una API v2 de avisos con categorías corporativas (marketing, finanzas y contabilidad, legales, administración). Se puede usar sin key (500 pedidos por hora) o con una key gratuita (3.600 por hora). Sus términos piden atribución y el link al aviso original, y prohíben el scraping de la web: la API es el único canal.
- La mayoría de los avisos son de Estados Unidos; muchos remotos piden autorización de trabajo allá.
- El formato documentado en la ficha sale de la documentación, no de una respuesta grabada: el contenedor de la nube no tiene salida a internet para grabarla.

## Decision (propuesta)

1. **Adapter `themuse`** en `packages/adapters/src/sources/themuse.ts`, con la misma forma que Jobicy: `fetchThemuseJobs` devuelve `RawJob[]`, `kind = "themuse"` (valor nuevo del enum `source_kind`, **migración**), atribución «vía The Muse» y `refs.landing_page` como URL canónica.
2. **Solo categorías de las carreras de la beta** (`Accounting`, `Finance`, `Legal`, `Marketing`, `PR`, `Business Operations`…) y `location=Flexible / Remote`. Nada presencial.
3. **Ubicación:** lo que el aviso no dice queda `null` (`countriesAllowed`), así el prefiltro marca el riesgo en vez de asumir «cualquier país». Si dice Estados Unidos, `countriesAllowed: ["US"]`.
4. **Detrás de `POOL_SOURCES`, apagada.** Con key (`THEMUSE_API_KEY`, opcional) si Mauro la registra; sin key, respetando el tope anónimo con un pedido cada pocos segundos y tope de páginas.
5. **Fixture grabada a mano** desde una máquina con salida a internet antes de escribir el adapter, sin datos personales. Tests sin red.

## Consequences

- Más ofertas de las carreras no tech, casi todas remotas para Estados Unidos: el prefiltro las va a marcar con riesgo de ubicación. Hay que medir antes qué porcentaje admite contratistas de LATAM (corrida exploratoria, punto 1 de la ficha).
- Una migración (enum) y un valor más en `POOL_SOURCES`.
- No cambia ADR-004: es una API pública de avisos, no una red social ni una postulación.

## Alternativas

- **No sumarla** y apostar a los boards de ATS de LATAM (`ats-staffing-latam.md`) y a las alertas de Computrabajo (ADR-024). Es lo que se recomienda para la apertura del 26/11: The Muse queda para después de medir.
