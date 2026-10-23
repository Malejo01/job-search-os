# Operación: comandos de administración

Tres comandos para operar la app sin depender de un cartero humano. Los tres comparten reglas:

- **Base local por defecto** (Docker). La nube solo con `--remote`, y entonces piden escribir `si` en una terminal; sin terminal abortan. Ni `--yes` ni `CONFIRM_PRODUCTION` saltean esa confirmación. La salida muestra solo `local (…)` o `remoto`, nunca el host de la nube.
- En producción **solo los corre Mauro**. Un agente no usa `--remote`.
- Nunca imprimen la URL de la base ni secretos. Los emails salen enmascarados (`l***@dominio`), salvo el link de `admin:invite`.
- Todos los datos de los ejemplos son ficticios (`@example.com`).

## `pnpm admin:invite`

```
pnpm admin:invite [--email <email>] --by <email-admin> [--remote]
```

Crea una invitación sin entrar a la app. `--by` es la cuenta que figura como creadora y tiene que estar en `ADMIN_EMAILS`. Con `--email`, solo ese email puede canjearla. Vence a los 14 días, igual que desde la página de invitaciones. Imprime el link (con `AUTH_URL` o `NEXT_PUBLIC_APP_URL`) **una sola vez**: en la base queda su sha256.

Ejemplo en local:

```
pnpm admin:invite --by admin@example.com --email nueva@example.com
```

## `pnpm admin:test-users`

```
pnpm admin:test-users --list | --reset <email> [--allowlist <ruta>] [--show-emails] [--yes] [--remote]
```

Lista y resetea **cuentas de prueba**, y solo las que figuran en la allowlist: un archivo de texto con un email por línea (`#` para comentarios). Por defecto `ops/test-users.txt` (no versionado), relativo a donde se lanzó `pnpm`. Sin allowlist, o vacía, el comando aborta.

- `--list`: por cada email de la allowlist, si existe, fecha de alta, si completó el onboarding y cuántos jobs, evaluaciones y postulaciones tiene. Los emails salen enmascarados salvo con `--show-emails`.
- `--reset <email>`: borra todos los datos de esa cuenta con el mismo borrado que «Eliminar mi cuenta». Pide escribir el email completo para confirmar (también en local) salvo con `--yes`, que solo vale en local. Nunca borra un email de `ADMIN_EMAILS`, y con `--remote` solo acepta la allowlist por defecto. **No recrea la cuenta**: el siguiente paso es `admin:invite` y registrarse de nuevo.

Ejemplo en local:

```
pnpm admin:test-users --list
pnpm admin:test-users --reset prueba@example.com
```

## `pnpm inbound:replay`

```
pnpm inbound:replay <fixture.json> --to <email-de-usuario> [--remote]
```

Reproduce un email **sintético** por el mismo camino que el webhook de Resend después de verificar la firma: guarda el crudo, deja la fila en `inbound_emails` y despacha por remitente. Sirve para probar la ingesta de punta a punta sin esperar un email real. Imprime el parser elegido, la cantidad de jobs, el destino (ingestado, cola manual, descartado o sin avisos) y el id de `inbound_emails`. Con `--remote`, `--to` tiene que ser una cuenta de la allowlist de prueba: un replay ingesta avisos y encola evaluaciones, que son llamadas pagas al LLM.

El fixture es un JSON validado con Zod: `from` y `subject` obligatorios, `text` y `headers` opcionales, y el cuerpo en `html` (en línea) o en `htmlFile` (ruta relativa al JSON, para reusar los HTML públicos de `packages/adapters/src/inbound/fixtures/**`). Hay un ejemplo en `packages/adapters/src/admin/fixtures/replay-linkedin-ejemplo.json`.

Ejemplo en local (el usuario tiene que existir y haber completado el onboarding):

```
pnpm inbound:replay packages/adapters/src/admin/fixtures/replay-linkedin-ejemplo.json --to prueba@example.com
```

Si el usuario no tiene criterios activos, el email queda en la cola manual con ese motivo: es el comportamiento normal del despacho, no un fallo del comando.

## Asignar un plan (beta paga, C-11b)

El cobro es externo, con el link de Mercado Pago. Cuando alguien paga, el plan se asigna a mano con un `UPDATE` puntual en el SQL Editor de Neon, **conectado como dueño**. El rol de la app no puede cambiarlo: lo frena el trigger `profiles_plan_guard` (`packages/db/rls/0010_plan.sql`).

```sql
begin;
-- Las claves válidas son gratis, fundador, lista y pase_3_meses (packages/pipeline/src/plans.ts).
-- El pase de 3 meses lleva su fecha de fin; el mensual, la del próximo vencimiento.
update profiles p
   set plan = 'pase_3_meses', plan_until = now() + interval '90 days', updated_at = now()
  from users u
 where u.id = p.user_id and u.email = 'persona@ejemplo.test';
-- Tiene que dar exactamente 1 fila antes de confirmar
select p.plan, p.plan_until from profiles p join users u on u.id = p.user_id
 where u.email = 'persona@ejemplo.test';
commit;
```

- **Vencimiento:** un plan pago con `plan_until` vencido rige como gratis, sin que haga falta tocar nada. Con `plan_until` en null el plan no vence: usalo solo si es a propósito.
- **Topes:** el plan cuenta solo con `PRICING_ENABLED=1`. Un tope propio del perfil (`max_target_roles` o `pool_daily_eval_limit`) le gana al del plan.
- **Primeras ofertas:** las 9 primeras evaluaciones del onboarding no dependen del plan.
- **La web nunca se conecta como dueño:** `DATABASE_URL_APP` tiene que ser `jobsearch_app`. Con el rol dueño, el trigger dejaría pasar cualquier cambio de plan sin avisar (y RLS tampoco aplicaría; `assertAppRole` lo frena al arrancar).

## Smoke post-deploy

Después de cada deploy exitoso a Production, `.github/workflows/smoke.yml` corre `apps/web/e2e-smoke/smoke.spec.ts` contra la URL de producción, que está fija en el workflow (nunca la del evento). Es **de solo lectura**: `/api/health`, login, `/jobs`, abrir la primera oferta si hay y `/applications`. No toca botones que escriban.

Sin secrets corre solo `/api/health` y el resto queda `skipped`. Para el recorrido con sesión, Mauro crea:

1. Una cuenta de prueba en producción, solo para esto: invitación con `admin:invite`, registro y onboarding.
2. Los secrets `E2E_PROD_EMAIL` y `E2E_PROD_PASSWORD` en GitHub (Settings → Secrets and variables → Actions). Nunca en el repo.

Si falla, el job queda en rojo y GitHub avisa. No sube trazas ni capturas: podrían mostrar datos de la cuenta de prueba.

Corrida manual, desde `apps/web`: `SMOKE_BASE_URL=<url> pnpm smoke`.

**Al publicar `TERMS_VERSION` el smoke falla** hasta que la cuenta de prueba entre a la app y vuelva a aceptar los términos. Después de subir la versión, hacer ese re-aceptado a mano y recién entonces volver a correr el smoke.

## Piloto: qué mirar cada día

Unos 15 minutos por día, en este orden:

1. **Mail.** Avisos de GitHub (el workflow `cron` en rojo, `smoke-roto`) y, cuando exista, el monitor externo.
2. **Gasto de IA.** `pnpm llm:spend --days 1`. Si pasa de USD 1,5 en un día, mirar de quién es el gasto (`llm_calls.user_id`) antes de subir el tope.
3. **Estado del servicio.** `/api/cron/status` (un `curl` con el token). `queue_oldest_pending_hours` y `queue_failed_24h` dicen si el evaluador está atascado.
4. **Actividad de las cuentas del piloto.** No hay panel. `pnpm admin:test-users --list --allowlist <archivo>` devuelve por cada email: fecha de alta, onboarding completo y cuántos jobs, evaluaciones y postulaciones tiene. Usar un archivo aparte, no versionado (un email por línea), distinto de la allowlist de cuentas de prueba. **Nunca `--reset` con esa lista**: borraría los datos de una persona real.
5. **👍/👎 y «Calibración».** Por ahora solo se ven por cuenta, no agregados. Durante el piloto, preguntarles directamente a las personas.
6. **Una vez por semana.** `pnpm pool:rehint` sin `--apply`, para ver si las carreras que estaban sobre el tope de ofertas siguen igual.
