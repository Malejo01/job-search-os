# ADR-019: Cuatro carreras de producto en lugar de «Producto y proyectos»

**Status:** Accepted · **Date:** 2026-10-21 · Reemplaza el punto 1 de ADR-015 solo en lo de `producto_proyectos`.

## Context
ADR-015 sumó carreras digitales con una sola clave para producto: `producto_proyectos` («Producto y
proyectos»). En la práctica mezclaba cuatro oficios con avisos, skills y sueldos distintos:
Product Manager, Product Owner, Project Manager o Scrum Master, y Product Marketing. Este último
ni siquiera tenía un término de título que lo reconociera. El feedback de la beta lo marcó: quien
busca Product Owner recibía avisos de Project Manager y al revés.

## Decision
1. **Cuatro `RoleKey` nuevos:** `product_manager`, `product_owner`, `project_manager` (incluye
   Scrum Master y Agile Coach) y `product_marketing`. El selector queda con 16 carreras en 3 grupos.
   `producto_proyectos` deja de elegirse.
2. **La clave vieja se traduce, no se rompe.** `LEGACY_ROLE_KEYS` y `toRoleKey` llevan
   `producto_proyectos` a `product_manager` en el perfil, la ingesta, el worker y el onboarding. Las
   URLs públicas `/mercado/producto_proyectos` y `/ofertas/producto_proyectos` responden 308 a
   `product_manager`.
3. **La separación la hacen los títulos, no el prefiltro.** Cada carrera tiene sus títulos típicos
   (`role_hints`) y veta los de las otras tres en `titleFit`. El prefiltro solo deja de descartar
   los títulos propios de cada carrera, aunque digan «manager».
4. **Datos.**
   - **0033 (generada):** amplía el check de `waitlist` con las claves nuevas.
   - **0034 (custom, idempotente):** da de alta 7 skills y migra `profiles.target_roles` y
     `target_role` según el titular del perfil (Product Owner y Product Marketing antes que
     proyectos; sin pista, `product_manager`). También migra `jobs.matched_role` con la misma
     regla y la lista de espera a `product_manager`.
   - **Orden:** merge → deploy → `pnpm db:migrate` enseguida. Si se aplica antes del deploy, el
     código viejo descarta las claves nuevas.
5. **Sin cambios en el evaluador.** El prompt sigue sin disciplina propia para producto: el
   límite de ADR-015 queda igual, y el rótulo más preciso ayuda.

## Consequences
- Las cuatro carreras arrancan con menos datos de mercado que la carrera unida. Con menos de 10
  ofertas se muestra «pocos datos».
- El tope gratis sigue en 2 puestos. Quien hacía «de todo un poco» en producto gasta más cupos:
  hay que mirarlo después de una semana de uso.
- **Contracción pendiente**, en otra ronda: sacar `producto_proyectos` del check y borrar
  `LEGACY_ROLE_KEYS`, con los conteos en 0 en Neon.
