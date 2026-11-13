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
pnpm admin:test-users --list | --reset <email> | --reset-all | --create --by <email-admin> [--credentials <ruta>] [--allowlist <ruta>] [--show-emails] [--yes] [--remote]
```

Lista, crea y resetea **cuentas de prueba**, y solo las que figuran en la allowlist: un archivo de texto con un email por línea (`#` para comentarios). Por defecto `ops/test-users.txt` (no versionado), relativo a donde se lanzó `pnpm`. Sin allowlist, o vacía, el comando aborta. El modelo de la lista está en `docs/beta/test-users.example.txt` (17 cuentas: una de auditoría y 2 por cada carrera de la beta, en el dominio reservado `example.com`): copiarlo a `ops/test-users.txt`.

- `--create --by <email-admin>`: crea las cuentas de la allowlist **por el mismo camino que el registro real** (una invitación del admin de `--by`, que tiene que estar en `ADMIN_EMAILS`, y `register_with_invitation_v3`, con la casilla de ingesta y los términos vigentes de `apps/web/lib/terms.ts`). La contraseña de cada una es aleatoria (192 bits) y va **solo** a `ops/test-users-credenciales.json` (no versionado; `--credentials <ruta>` para otro archivo). Nunca se imprime: ni en la terminal ni en los logs. Es idempotente: las que ya existen se saltean y lo dice; una cuenta de `ADMIN_EMAILS` se omite. Si una cuenta existe pero no tiene contraseña guardada, `--reset <email>` y `--create` de nuevo.
- `--credentials <ruta>` solo acepta rutas relativas bajo `ops/` (sin `..`). `--reset <email>` y `--reset-all` solo borran cuentas con `is_test`: `--reset-all` saltea con aviso las que no la tienen, y `--reset <email> --force` borra una cuenta de la allowlist sin marca (por ejemplo una creada antes de la 0065).
- `--reset-all`: borra **todas** las cuentas de la allowlist marcadas como de prueba con una sola confirmación (hay que escribir la frase `borrar cuentas de prueba`, también en local; `--yes` solo vale en local). Informa cada cuenta (borrada, no existe u omitida por ser admin) y saca sus contraseñas del archivo de credenciales.
- Las cuentas creadas se marcan `users.is_test = true` **después** del registro real (migración 0065). Esa marca las saca de `/settings/metricas` y de la madurez de las carreras (`rls/0020_cuentas_de_prueba.sql`, que redefine `admin_beta_metrics` y `career_maturity_stats`) y del aviso de vencimiento de plan. Además no reciben emails porque la bienvenida sale solo de acciones de un admin en `/settings/planes`, y los cupos de fundador solo cuentan planes que asigna un admin (una cuenta nueva queda en plan gratis). **Pendiente:** `/settings/salud` («personas activas hoy») todavía las cuenta. Requiere aplicar en Neon la 0065 y el rls nuevo, después de la 0064.

- `--list`: por cada email de la allowlist, si existe, fecha de alta, si completó el onboarding y cuántos jobs, evaluaciones y postulaciones tiene. Los emails salen enmascarados salvo con `--show-emails`.
- `--reset <email>`: borra todos los datos de esa cuenta con el mismo borrado que «Eliminar mi cuenta». Pide escribir el email completo para confirmar (también en local) salvo con `--yes`, que solo vale en local. Nunca borra un email de `ADMIN_EMAILS`, y con `--remote` solo acepta la allowlist por defecto. **No recrea la cuenta**: el siguiente paso es `admin:invite` y registrarse de nuevo.

Ejemplo en local:

```
pnpm admin:test-users --list
pnpm admin:test-users --reset prueba@example.com
pnpm admin:test-users --create --by admin@example.com
pnpm admin:test-users --reset-all
```

### Recorrido por carreras (`pnpm recorrido <url>`)

Para cada cuenta de `ops/test-users-credenciales.json` con un perfil de carrera (`apps/web/recorrido/perfiles.ts`: `<carrera>-junior` o `<carrera>-con-experiencia`; `auditoria` se saltea): inicia sesión, hace el onboarding con los datos del perfil, carga skills, espera las primeras ofertas y abre hasta 40 ofertas evaluadas. La URL tiene que ser https (http solo en localhost o 127.0.0.1). **Solo lee**: no postula ni marca estados, y aborta todo pedido a otro dominio que el de la URL. Guarda en `ops/recorrido-carreras/<fecha>/` capturas a 390 y 1280 px y un JSON por cuenta (ofertas vistas con fuente, título, puntaje, veredicto, motivos y requisitos faltantes; skills del catálogo pedidas y ausentes; tiempos). No corre en el CI: tiene su propia config (`apps/web/playwright.recorrido.config.ts`).

```
pnpm recorrido http://localhost:3000
pnpm recorrido http://localhost:3000 -g abogacia-junior
```

Primero en local (`node .claude/bin/local.mjs dev` y, con el worker demo, sin gasto). **Contra producción** crea evaluaciones reales (gasto de LLM, ≈ USD 0,007 por oferta evaluada) y cuentas en Neon: es decisión de Mauro y conviene mirar `pnpm llm:spend --days 1` antes y después. Los selectores del onboarding y de la oferta se copiaron de los e2e de personas y no se probaron contra una app corriendo: la primera corrida puede pedir un ajuste.

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

## Activar un plan (beta paga, C-11b y C3-1)

El cobro es externo: la persona paga el mes con el link de Mercado Pago (ARS 20.000; los USD 15 son solo una referencia) o por transferencia. Desde el 5/11 se cobra por una **cuenta nueva de Mercado Pago, compartida**: hay que actualizar los links `MP_LINK_*` (ver `docs/beta/runbook-apertura.md`, «Decisiones del 5/11»). Después de pagar, y **Mauro lo activa a mano**. La app no sabe si alguien pagó ni guarda datos de tarjetas.

### Desde el panel (lo normal)

`Ajustes → Planes de la beta` (`/settings/planes`, solo cuentas de `ADMIN_EMAILS` que además estén en `app_admins`; el link de Ajustes aparece con `PRICING_ENABLED=1`).

- **Activar 30 días:** email de la persona (tiene que haber terminado el onboarding) y cómo llegó: **Pagó** o **Becado** (primer mes gratis). Los 30 días cuentan desde hoy; si la beta todavía no abrió, desde el 26/11/2026; si la persona ya tenía días, se suman a la fecha en la que vencía, así renovar antes de tiempo no hace perder días.
- **Becados:** se los marca como «Becado» y cuando después pagan se los vuelve a activar como «Pagó» con el mismo link. Desde el 5/11 las becas de la beta son **un becado gratis y dos con 50 % de descuento** (y dos personas más no pagan, definidas en Notion). El panel no tiene una opción de 50 % ni de combos: [A DEFINIR: combos de Ani]. Quiénes son y si las dos personas que no pagan entran en esos lugares: [A CONFIRMAR con Mauro]; los nombres se llevan en Notion, no acá.
- **Quitar el plan:** pasa a la persona a «gratis» y pierde los días que le quedaban. No borra nada de lo suyo.
- **Quién tiene acceso:** la lista muestra origen y hasta cuándo llega cada persona, los que vencen antes arriba.
- Si la persona tiene un plan viejo (fundador o pase de 3 meses), el panel no lo toca: se cambia a mano (abajo).

Por dentro son las funciones `admin_plan_get`, `admin_plan_list` y `admin_plan_set` (`packages/db/rls/0015_admin_planes.sql`, `SECURITY DEFINER`, exigen `app_admins`). La fecha de fin la calcula el código (`packages/pipeline/src/plan-access.ts`); la base solo la acota (entre ahora y 400 días).

### A mano (planes viejos o si el panel no anda)

Con un `UPDATE` puntual en el SQL Editor de Neon, **conectado como dueño**. El rol de la app no puede cambiarlo: lo frena el trigger `profiles_plan_guard` (`packages/db/rls/0010_plan.sql`, que protege `plan`, `plan_until` y `plan_source`).

```sql
begin;
-- Las claves válidas son gratis, fundador, lista y pase_3_meses (packages/pipeline/src/plans.ts).
-- plan_source es 'pago', 'beca' o null.
update profiles p
   set plan = 'lista', plan_source = 'pago', plan_until = now() + interval '30 days', updated_at = now()
  from users u
 where u.id = p.user_id and u.email = 'persona@ejemplo.test';
-- Tiene que dar exactamente 1 fila antes de confirmar
select p.plan, p.plan_source, p.plan_until from profiles p join users u on u.id = p.user_id
 where u.email = 'persona@ejemplo.test';
commit;
```

### Qué ve la persona y qué pasa al vencer

- En **Ajustes → Tu plan** ve hasta qué fecha llega su acceso, si es una beca, y cómo renovar (link de Mercado Pago, transferencia por email).
- **Tres días antes** de vencer aparece un aviso arriba de toda la app («Te quedan 2 días de acceso a la beta») con el link a cómo renovar. No hay email: ver la propuesta en el PR.
- **Al vencer**, el plan pasa solo a «gratis» (`effectivePlan`), con los topes del gratis. El aviso cambia a «venció, tus datos siguen guardados». No se borra ni se oculta nada: ofertas, postulaciones, perfil y skills quedan igual. Al volver a activar, retoma el plan completo.

### Reglas que no cambian

- **Vencimiento:** un plan pago con `plan_until` vencido rige como gratis, sin que haga falta tocar nada. Con `plan_until` en null el plan no vence: usalo solo si es a propósito.
- **Topes:** el plan cuenta solo con `PRICING_ENABLED=1`. Un tope propio del perfil (`max_target_roles` o `pool_daily_eval_limit`) le gana al del plan.
- **Primeras ofertas:** las 9 primeras evaluaciones del onboarding no dependen del plan.
- **La web nunca se conecta como dueño:** `DATABASE_URL_APP` tiene que ser `jobsearch_app`. Con el rol dueño, el trigger dejaría pasar cualquier cambio de plan sin avisar (y RLS tampoco aplicaría; `assertAppRole` lo frena al arrancar).

## Conexiones a la base: `DB_POOL_MAX` (R8-4)

La web abre un pool de conexiones **por instancia** de Vercel (`apps/web/lib/db.ts`). `DB_POOL_MAX` fija el tamaño: entero de 1 a 20; ausente, vacía o inválida (con un aviso en el log) vale **5**, como antes. Se cambia en Vercel (solo Mauro) y rige en el próximo deploy.

**La cuenta.** Conexiones simultáneas máximas = instancias activas × `DB_POOL_MAX`, y eso más lo que abren el worker y los crons (cada uno con su propia conexión) tiene que quedar por debajo del límite de la base. Ejemplo: 10 instancias × 5 = 50 conexiones.

- **Límite de Neon Free: a confirmar.** No está anotado en `docs/` (`docs/beta/capacidad.md` solo cubre la transferencia). Se verifica en la consola de Neon y en <https://neon.com/docs/connect/connection-pooling>; el máximo de conexiones directas depende del tamaño de cómputo del plan.
- **Pooler de Neon (`-pooler` en el host de la URL).** Acepta muchas más conexiones de cliente que el límite directo, a cambio de modo transacción (por eso `createDb` usa `prepare: false`; `withUser` fija `app.user_id` con `set_config(..., true)` dentro de la transacción, compatible). Si la cuenta se acerca al límite directo, la salida es usar la URL con `-pooler` en `DATABASE_URL_APP`, no subir `DB_POOL_MAX`.
- **Subirlo no acelera nada** si las consultas de una página ya van en paralelo con 5: solo sirve cuando hay más de 5 consultas simultáneas por instancia. Ante la duda, dejarlo en 5.

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
4. **Actividad de las cuentas del piloto.**
   - **Agregados:** el tablero de la beta, en `/settings/metricas` (solo admin, #197). Muestra usuarios activos, evaluaciones, % de 👍, postulaciones y carreras «maduras» o «en pulido». Con menos de 3 personas en un grupo, no muestra el número.
   - **Detalle por cuenta:** `pnpm admin:test-users --list --allowlist <archivo>` devuelve por cada email la fecha de alta, si completó el onboarding y cuántos jobs, evaluaciones y postulaciones tiene. Usar un archivo aparte, no versionado (un email por línea), distinto de la allowlist de cuentas de prueba. **Nunca `--reset` con esa lista**: borraría los datos de una persona real.
5. **👍/👎 y «Calibración».** El % de 👍 está en el tablero de la beta. El porqué de cada 👎 solo se ve por cuenta: durante el piloto, preguntarles directamente a las personas.
6. **Una vez por semana.** `pnpm pool:rehint` sin `--apply`, para ver si las carreras que estaban sobre el tope de ofertas siguen igual.

## Casillas del pool por alertas de email (ADR-024)

Fuente de la beta cerrada, **apagada por defecto**. Las casillas `pool-<carrera>@<INGEST_DOMAIN>` reciben las alertas que suscribe Job Search; `<carrera>` es una clave de `ROLE_KEYS` (por ejemplo `pool-rrhh_it@`).

- **Prender:** variable `POOL_SOURCE_COMPUTRABAJO_ALERTS=1` en Vercel (solo Mauro). Cualquier otro valor es apagado. Hace falta `INGEST_DOMAIN`.
- **Crear las casillas:** no hay que crear nada en Resend; la dirección se usa como email de la alerta en el portal. El dominio de remitente aceptado está en `POOL_ALERT_SENDER_DOMAINS` (`packages/adapters/src/inbound/pool-mailbox.ts`); si el portal manda desde otro dominio o variante por país, se agrega ahí tras ver un email real.
- **Qué pasa hoy:** sin lector validado con emails reales, un email del portal a una casilla va a la cola manual del pool (fila de `inbound_emails` sin usuario, parser `pool_computrabajo_alerts`, `jobs_extracted` 0). No se extrae nada y no aparece en la bandeja de ninguna persona.
- **Rechazos:** interruptor apagado, otro remitente, carrera inexistente u otro dominio: no se guarda nada y el webhook responde como con un destinatario desconocido.
- **Si hay una `u_…` entre los destinatarios:** gana el flujo normal y el email no va al pool. Se decide primero por el sobre (`received_for`) cuando existe.
- **Topes de la cola:** 30 emails por hora y 200 por día (filas sin usuario con el parser del pool); pasados los topes se rechaza como destinatario desconocido, sin guardar, solo con un contador en el log. Un crudo de más de 256 KB guarda solo remitente, asunto y fecha.
- **Purga:** las filas del pool y su crudo se borran a los 30 días (la purga programada, solo `user_id IS NULL` y parser del pool).
- **Verla:** la cola del pool no tiene pantalla. Se mira solo con SQL (`inbound_emails` con `user_id IS NULL` y `parser = 'pool_computrabajo_alerts'`), que corre Mauro.
- **Apagar:** quitar la variable o ponerla en `0`. Vale desde el siguiente email.
- **Migración:** el valor `computrabajo_alerts` de `source_kind` (0046) lo aplica Mauro con `pnpm db:migrate` antes del merge.

## Alertas de gasto de IA (R7-1, R8-5)

Al pasar el 70, 85 y 95 % de `LLM_DAILY_CAP_USD` (gasto de 24 h) sale un email a **cada** admin de `ADMIN_EMAILS`, una vez por umbral, por destinatario y por día UTC. Sin migración: la marca es una fila `budget_alert` en `llm_calls` (label `<día>:<umbral>:<hash del email>`; las de R7-1, sin hash, valen para todos).

- **Cuándo se revisa:** en cada corrida del cron de evaluación (cada 6 h) **y** al terminar una evaluación fuera del cron (pegar aviso, reasignación por cambio de puesto). Esas revisiones usan un memo en memoria del proceso: con el umbral más alto ya entregado a todos no consultan nada, y si no, miran como mucho cada 5 minutos. **En serverless el memo es por instancia**: una instancia en frío consulta una vez más. Lo que garantiza «una vez por umbral, destinatario y día» es la marca en base (con lock de asesoría por día), no el memo.
- **Envío parcial:** se manda y recién después se anota, por destinatario. Si falla Resend para uno, no se anota y la próxima revisión reintenta solo a ese.
- **Si el proceso muere entre mandar y anotar:** la próxima revisión reenvía con la misma clave de idempotencia de Resend (`budget-alert:<día>:<umbral>:<hash del email>`), que Resend deduplica durante 24 h; no llega dos veces. La clave es por destinatario, no por posición en `ADMIN_EMAILS`.
- **Límite conocido:** el email que reenvía una alerta ya entregada pero sin anotar depende de esa ventana de 24 h de Resend. Para un reintento de otro día, la marca del día nuevo es otra y se manda de nuevo (es lo esperado: es otro día).
