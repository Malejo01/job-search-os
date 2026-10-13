# ADR-016: Varios puestos a la vez, con tope por plan

**Status:** Accepted · **Date:** 2026-10-12

## Context
Hasta la ronda 44 una persona buscaba un solo puesto (`profiles.target_role`) o ninguno («Otro o
varios»). La beta mostró dos problemas: quien busca más de un puesto (por ejemplo QA y Data
Analyst) no podía decirlo, y Ajustes mostraba un puesto preseleccionado de forma engañosa cuando
la persona no había elegido ninguno.

## Decision
1. **Datos.** `profiles.target_roles text[]` (default `{}`), `profiles.max_target_roles integer`
   (null = el default por entorno) y `jobs.matched_role text` (null). `target_role` se queda como
   el puesto principal, el primero de la lista, y se escribe siempre junto con ella: el código viejo
   sigue andando entre la migración y el deploy. Los lectores nuevos usan `target_roles`. Migración
   0020 generada y 0021 de datos (backfill idempotente).
2. **Tope por plan.** `TARGET_ROLES_FREE_LIMIT` (default 2, de 1 a 13) y `max_target_roles` del
   perfil, resueltos por `targetRolesLimit`. `parseTargetRoles` valida en el servidor: solo claves
   de `ROLE_KEYS`, sin repetir, entre 1 y el tope. La pantalla (`RolePicker`) solo ayuda; sin JS
   funciona igual.
3. **El tope es una palanca de producto, no de costo.** Cada oferta se evalúa una sola vez y
   `pool_daily_eval_limit` acota el gasto; sumar puestos no lo multiplica. El tope existe para
   poder ofrecer más puestos en un plan pago (próximamente), no para cuidar el presupuesto.
4. **Selección.** El paso 1 y Ajustes («Tus puestos», con los actuales en texto arriba) usan casillas
   agrupadas. Se elimina «Otro o varios»: el paso 1 exige al menos uno. Mis skills ya no cambia los
   puestos; sus pills solo sugieren skills, con los elegidos primero.
5. **Asignación.** Con puestos entra lo que comparte `role_hints` con alguno o no tiene señal; sin
   puestos, solo IT (ADR-015). El orden intercala los puestos por pre-score (`interleaveByRole`) con
   los mismos topes de siempre, y cada oferta asignada guarda `matched_role`. La ronda 43 se lo
   pasará al evaluador para que sepa por qué puesto se la eligió.
6. **Mercado.** `/market` tiene una pestaña por puesto elegido (`?rol=<clave>`, conserva el rango
   de semanas); un puesto ajeno a la selección se ignora y cae en el principal. `/plan` no tiene
   pestañas: el plan es uno por persona y su nota usa el puesto principal.

## Consequences
- Cambiar el conjunto de puestos reasigna el pool como el cambio de puesto de la ronda 41.
- El plan de formación sigue siendo uno por persona (`learning_plan_items` no tiene puesto), por
  eso `/plan` no tiene pestañas. Un plan por puesto pide una columna nueva: ticket futuro.
- Un plan pago pide solo poner `max_target_roles` o subir la variable: no hay migración.
