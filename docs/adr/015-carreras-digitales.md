# ADR-015: Carreras digitales además de IT

**Status:** Accepted · **Date:** 2026-10-12

## Context
La beta suma personas que no buscan puestos de programación: marketing digital, producto y
proyectos, recruiting IT, customer success y ciberseguridad. El pool (ADR-014) y el prefiltro
estaban pensados para tecnología: sin cambios, un "SEO Specialist" o un "Project Manager" se
descartaba por `other_discipline_keywords`, y Get on Board no traía esas categorías.

## Decision
1. **Puestos nuevos en `ROLE_KEYS`**, al final (el orden de los existentes no cambia):
   `marketing_digital`, `producto_proyectos`, `rrhh_it`, `customer_success` y `ciberseguridad`.
   Se agrupan en `ROLE_GROUPS` ("Tecnología" y "Carreras digitales") para el selector. No se toca
   `discipline` del evaluador: es su esquema de respuesta y cambiarlo pide evals pagos.
   `target_role` es texto validado contra `ROLE_KEYS`, así que no hace falta `ALTER`.
2. **Prefiltro con excepción por puesto** (`PrefilterOptions.targetRole`): las palabras de
   `other_discipline_keywords` que son el oficio del puesto (por ejemplo `seo` para marketing,
   `project manager` para producto) no descartan. Sin puesto o sin la opción, todo como antes. Lo
   usan la asignación del pool y la ingesta por usuario.
3. **Categorías de Get on Board** en el pool: `digital-marketing`, `hr`, `innovation-agile`,
   `technical-support` y `cybersecurity`. Mapean a marketing, rrhh_it, producto, soporte_it y
   ciberseguridad; `customer-support` (ya estaba) a customer_success.
4. **Cuentas sin puesto solo reciben IT:** candidatas con `role_hints` vacío o con algún puesto
   de `IT_ROLE_KEYS`. Un aviso marcado solo con puestos digitales no entra. Con puesto, igual que antes.
5. **Migración 0019, de datos:** suma 19 skills y hace de `hubspot` una skill propia. La aplica
   Mauro con `pnpm db:migrate` antes del merge.

## Qué se excluye y por qué
`sales`, `education-coaching`, `advertising-media`, `operations-management`, `other` y
`hardware-electronics` no se suman: son ventas, educación, publicidad y categorías sin puesto
claro, que traerían ruido a un prefiltro pensado para tecnología y carreras digitales. "Atención
al cliente" y "call center" siguen descartando.

## Consequences
- Las categorías nuevas necesitan backfill: `since` sale de la última corrida ok de la fuente, y
  sin reiniciar la bitácora solo traerían el último día. Lo reinicia Mauro después del merge.
- **Límite conocido:** el evaluador no tiene disciplina propia para estos puestos; los clasifica
  como `negocio` u `otra` (ADR-011 hunde el score si la disciplina difiere). Se resuelve en una
  ronda con evals, que cambie `DISCIPLINES` y el prompt.
