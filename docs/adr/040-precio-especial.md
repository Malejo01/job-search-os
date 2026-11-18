# ADR-040: Precio especial por persona (becados y testers)

**Status:** Accepted (decisión de diseño de la tanda R15) · **Date:** 2026-11-18 · Amplía [ADR-002](./002-multitenant-desde-fase-1.md) y el modelo de planes de `packages/pipeline/src/plans.ts`.

## Context
- Hay personas a las que no se les cobra el precio completo: quienes tienen una beca y quienes prueban la app como testers (50 % de descuento). Hoy el único dato es `profiles.plan_source = 'beca'`, que dice cómo llegó el acceso, no qué se le ofrece para pagar.
- El cobro es un link externo de Mercado Pago por plan (`MP_LINK_*`), sin API ni webhooks. Un descuento es, entonces, **otro link**, no un cálculo de la app. Ningún monto cambia en el código.
- La persona puede actualizar su propia fila de `profiles` (policy `profiles_owner`, con trigger que protege solo `plan`). Una marca de descuento puesta ahí podría tocarla ella misma.

## Decision
1. **Tabla propia `plan_overrides`**: `user_id` (PK, FK a `users` con cascade), `override` (`becado` | `tester_50`, con CHECK) y `created_at`. No es una columna de `profiles`.
2. **RLS con `FORCE`** (`packages/db/rls/0022_plan_overrides.sql`): cada persona lee **solo su fila**; no hay policy de INSERT, UPDATE ni DELETE para los roles de la app. La escritura va únicamente por `admin_plan_override_set(email, override)` (SECURITY DEFINER, barrera `app_admins`, `override` nulo la saca) y la lectura de la lista por `admin_plan_override_list`. Mismo patrón que `admin_beta_feedback_set_status`.
3. **Decisión en el pipeline** (`packages/pipeline/src/plan-override.ts`, puro): `paymentOffer(env, plan, marca)` devuelve qué mostrar.
   - Sin marca: como hoy (el link del plan, o ninguno).
   - `becado`: sin link y «Tu plan está bonificado.».
   - `tester_50`: el link de `MP_LINK_TESTER_50`, con la misma validación de host que los demás. **Si la variable falta o no es válida, falla cerrado**: nunca se muestra el link de precio completo como si fuera el descuento; se pide escribir al equipo. Una marca desconocida se trata igual.
4. **Dónde se aplica**: «Tu plan» en Ajustes y el aviso por email de vencimiento (`plan-expiry-notices`), que de otro modo mandaría el link de precio completo a un tester o a un becado. Si en Ajustes no se puede leer la marca, se pide escribir al equipo.
5. **Panel de admin**: sección «Precio especial» en `/settings/planes` para poner y sacar la marca por email. La marca no cambia la fecha del plan: la activación sigue siendo manual.
6. Al borrar la cuenta la marca cae por cascade (`USER_TABLES`, acción `cascade`).

## Consequences
- Una persona no puede darse un descuento a sí misma ni leer la marca de otra; lo prueban los tests de integración de `plan-overrides` y los de aislamiento multiusuario.
- La migración (tabla + policies + funciones) la aplica el dueño del proyecto en Neon; el cron de avisos y «Tu plan» dependen de que exista.
- Un tester necesita que `MP_LINK_TESTER_50` esté cargada; sin ella ve un mensaje y no un link.
- No hay historial de cambios de marca ni quién la puso (solo `created_at` de la primera vez): si hace falta auditar, se agrega una columna en otra migración.
- Alternativas descartadas: columna en `profiles` (la persona puede actualizarla); un descuento calculado por la app (hay un solo link por precio y no hay API de Mercado Pago).
