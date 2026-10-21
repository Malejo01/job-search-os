# ADR-020: Get on Board suma operaciones y publicidad al pool

**Status:** Accepted · **Date:** 2026-10-21

## Context
Casi todo lo que hay en español en el pool viene de Get on Board. La API lista 18 categorías y el pool ingiere 12. El ADR-015 dejó fuera seis: `sales`, `education-coaching`, `advertising-media`, `operations-management`, `other` y `hardware-electronics`, porque no tenían un puesto claro.

`marketing_digital` existe desde el ADR-015, y `project_manager` es carrera propia desde el ADR-019. Para esas dos carreras sí hay ofertas en dos de las categorías excluidas.

## Decision
1. **`operations-management` → `project_manager`** y **`advertising-media` → `marketing_digital`** entran en `GOB_POOL_CATEGORIES` y en `SOURCE_CATEGORY_ROLES`.
   - Operaciones trae también gerencia y administración.
   - Como con las categorías de producto, la categoría da la carrera posible y `titleFit` separa por título.
2. **Toda categoría del pool tiene que mapear al menos a una carrera.** Un aviso con `role_hints` vacío le llega a quien no eligió puesto como si fuera de IT (ADR-015, punto 4). Un test lo verifica.
3. **`sales` sigue fuera** hasta que exista una carrera de ventas (H2 del roadmap). `education-coaching`, `other` y `hardware-electronics` siguen fuera.
   - **Superado por el ADR-022 (ronda 107):** `sales` entra y mapea a `ventas_b2b`. Siguen fuera `education-coaching`, `other` y `hardware-electronics`.
4. **El tope de requests no cambia:** 10 páginas por categoría y el mismo timeout. Con la ventana de 48 h del pool, cada categoría es una request por corrida, así que se pasa de 12 a 14.

## Consequences
- Entre las dos categorías suman unos 5 avisos nuevos por día, medidos el 2026-10-21 con la página 1 de cada una. Muchos traen `lang` sin especificar; la detección de idioma del pool los clasifica.
- Las categorías nuevas necesitan backfill. Como en el ADR-015, `since` sale de la última corrida ok de la fuente, así que después del merge hay que reiniciar la bitácora de Get on Board. Lo hace Mauro.
- El límite conocido del ADR-015 sigue vigente: el evaluador no tiene disciplina propia para estas carreras.
