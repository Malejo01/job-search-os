# Operación: comandos de administración

Tres comandos para operar la app sin depender de un cartero humano. Los tres comparten reglas:

- **Base local por defecto** (Docker). La nube solo con `--remote`, y entonces piden escribir `si` en una terminal; sin terminal abortan. Ni `--yes` ni `CONFIRM_PRODUCTION` saltean esa confirmación. La salida muestra solo `local (…)` o `remoto`, nunca el host de la nube.
- En producción **solo los corre Admin**. Un agente no usa `--remote`.
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

Primero en local (`node .claude/bin/local.mjs dev` y, con el worker demo, sin gasto). **Contra producción** crea evaluaciones reales (gasto de LLM, ≈ USD 0,007 por oferta evaluada) y cuentas en Neon: es decisión de Admin y conviene mirar `pnpm llm:spend --days 1` antes y después. Los selectores del onboarding y de la oferta se copiaron de los e2e de personas y no se probaron contra una app corriendo: la primera corrida puede pedir un ajuste.

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

El cobro es externo: la persona paga el mes con el link de Mercado Pago (ARS 20.000; los USD 15 son solo una referencia) o por transferencia. Desde el 5/11 se cobra por una **cuenta nueva de Mercado Pago, compartida**: hay que actualizar los links `MP_LINK_*` (ver `docs/beta/runbook-apertura.md`, «Decisiones del 5/11»). Después de pagar, y **Admin lo activa a mano**. La app no sabe si alguien pagó ni guarda datos de tarjetas.

### Desde el panel (lo normal)

`Ajustes → Planes de la beta` (`/settings/planes`, solo cuentas de `ADMIN_EMAILS` que además estén en `app_admins`; el link de Ajustes aparece con `PRICING_ENABLED=1`).

- **Activar 30 días:** email de la persona (tiene que haber terminado el onboarding) y cómo llegó: **Pagó** o **Becado** (primer mes gratis). Los 30 días cuentan desde hoy; si la beta todavía no abrió, desde el 26/11/2026; si la persona ya tenía días, se suman a la fecha en la que vencía, así renovar antes de tiempo no hace perder días.
- **Becados:** se los marca como «Becado» y cuando después pagan se los vuelve a activar como «Pagó» con el mismo link. Desde el 5/11 las becas de la beta son **un becado gratis y dos con 50 % de descuento** (y dos personas más no pagan, definidas en Notion). El panel no tiene una opción de 50 % ni de combos: [A DEFINIR: combos de tester A]. Quiénes son y si las dos personas que no pagan entran en esos lugares: [A CONFIRMAR con Admin]; los nombres se llevan en Notion, no acá.
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

La web abre un pool de conexiones **por instancia** de Vercel (`apps/web/lib/db.ts`). `DB_POOL_MAX` fija el tamaño: entero de 1 a 20; ausente, vacía o inválida (con un aviso en el log) vale **5**, como antes. Se cambia en Vercel (solo Admin) y rige en el próximo deploy.

**La cuenta.** Conexiones simultáneas máximas = instancias activas × `DB_POOL_MAX`, y eso más lo que abren el worker y los crons (cada uno con su propia conexión) tiene que quedar por debajo del límite de la base. Ejemplo: 10 instancias × 5 = 50 conexiones.

- **Límite de Neon Free: a confirmar.** No está anotado en `docs/` (`docs/beta/capacidad.md` solo cubre la transferencia). Se verifica en la consola de Neon y en <https://neon.com/docs/connect/connection-pooling>; el máximo de conexiones directas depende del tamaño de cómputo del plan.
- **Pooler de Neon (`-pooler` en el host de la URL).** Acepta muchas más conexiones de cliente que el límite directo, a cambio de modo transacción (por eso `createDb` usa `prepare: false`; `withUser` fija `app.user_id` con `set_config(..., true)` dentro de la transacción, compatible). Si la cuenta se acerca al límite directo, la salida es usar la URL con `-pooler` en `DATABASE_URL_APP`, no subir `DB_POOL_MAX`.
- **Subirlo no acelera nada** si las consultas de una página ya van en paralelo con 5: solo sirve cuando hay más de 5 consultas simultáneas por instancia. Ante la duda, dejarlo en 5.

## Variables de modo y de plazo del correo entrante

Se leen con un solo lector: se ignoran mayúsculas y espacios (`ENFORCE`, ` enforce `). Un valor desconocido **no apaga ni enciende nada por error**: rige el valor por defecto y la app registra un `error` en el log con el nombre de la variable (sin copiar el valor), una sola vez por proceso. Todas son un paso manual de Admin en Vercel y necesitan redeploy.

| Variable | Valores | Por defecto | Con un valor inválido |
|---|---|---|---|
| `INBOUND_SIZE_MODE` | `log`, `enforce` | `log` | rige `log` (el email grande se registra y se procesa) y queda el `error`. |
| `INBOUND_DMARC_MODE` | `off`, `log`, `enforce` | `log` | rige `log` (se mide sin retener) y queda el `error`. Ver la sección siguiente. |
| `INBOUND_RAW_RETENTION_DAYS` | entero de 1 a 3650 | sin valor | la purga de crudos queda apagada, como sin valor, y queda un `error` en cada corrida del cron (por ejemplo con `30d`). Los crudos huérfanos (sin fila ni oferta) se purgan siempre, con un día de antigüedad; un email pendiente conserva su crudo hasta 90 días y después se purga igual (la bandeja lo muestra como «venció»). |
| `INBOUND_MAX_BYTES_PER_USER` | entero de bytes, de 1 000 000 a 107 374 182 400 | `209715200` (200 MB) | rige el valor por defecto y queda el `error`. Pasado el tope de crudo retenido por persona, el email nuevo no guarda su contenido: queda su fila (remitente, asunto y fecha) con el motivo «almacenamiento de correo lleno» y suma al contador de rechazados de `/inbox`. |

- **Ausente o vacía** no es un error: rige el valor por defecto.
- **Antes de pasar a `enforce`:** en tamaño, mirar en el log cuántos emails superan el tope medido; en DMARC, ver la sección siguiente.
- Si ves un `error` de configuración en el log, la protección que querías encender sigue apagada.

## Autenticación del remitente del correo entrante: `INBOUND_DMARC_MODE` e `INBOUND_AUTHSERV_ID`

El veredicto sale solo del primer `Authentication-Results` del email, el que antepone el receptor propio. Es `aligned` si ese encabezado empieza con el identificador de servidor configurado y trae `dmarc=pass` con `header.from` igual al dominio del remitente. DKIM y SPF sueltos no cuentan, y lo que escriba quien envía tampoco.

| Variable | Default | Qué hace |
|---|---|---|
| `INBOUND_DMARC_MODE` | `log` | `off` no mira nada. `log` registra el veredicto (`auth_verdict` en el crudo) sin cambiar nada. `enforce` retiene el email de un remitente esperado que no quedó `aligned`. |
| `INBOUND_AUTHSERV_ID` | sin valor | Identificador de servidor (la primera palabra del encabezado) del receptor propio. Sin valor, el veredicto es siempre `none`: en `enforce` todo queda retenido. |

- **Antes de pasar a `enforce`:** dejar `log` unos días con correo real y mirar `auth_verdict` por remitente. Confirmar qué identificador de servidor llega en el encabezado y cargarlo en `INBOUND_AUTHSERV_ID`. Si no llega ningún `Authentication-Results`, `enforce` retendría todo, incluida la confirmación de reenvío de Gmail.
- **Email retenido:** en el detalle de `/inbox` aparece el botón «Procesar igual», que lo procesa como verificado. Lo puede usar solo la persona dueña.
- Ambas variables son un paso manual de Admin en Vercel y necesitan redeploy.

## Topes del asistente por charla (R9-2)

El asistente corta cada charla por mensajes y por gasto. Los defaults están en `packages/pipeline/src/agent/limits.ts` y se pueden cambiar sin deploy de código con dos variables de Vercel (paso manual de Admin; hace falta un redeploy para que las tome):

| Variable | Default | Valores válidos |
|---|---|---|
| `ASSISTANT_MAX_USD_PER_CONVERSATION` | `0.50` | número mayor que 0 y hasta 5, con punto decimal (`0.75`) |
| `ASSISTANT_MAX_TURNS` | `20` | entero de 1 a 50 |

- **Variable ausente o vacía:** rige el default, sin aviso.
- **Variable inválida** (`abc`, `0,5`, `0`, fuera de rango): rige el default y queda un `warn` en el log de la app (`asistente: variable de tope inválida…`), una vez por proceso. No tumba al asistente.
- **No cambia** `LLM_USER_DAILY_CAP_USD`, que sigue siendo el tope diario por persona.
- **Contador de mensajes** («Te quedan 2 mensajes…»): sale del mismo valor de `ASSISTANT_MAX_TURNS`, que el servidor le pasa al panel.
- **Medición:** `/settings/salud` (solo admins) tiene el bloque «Asistente, últimos 7 días» con charlas, mensajes por charla, costo por charla (promedio y p90) y cortes por tope. No muestra contenido de charlas ni ids de personas.

## Smoke post-deploy

Después de cada deploy exitoso a Production, `.github/workflows/smoke.yml` corre `apps/web/e2e-smoke/smoke.spec.ts` contra la URL de producción, que está fija en el workflow (nunca la del evento). Es **de solo lectura**: `/api/health`, login, `/jobs`, abrir la primera oferta si hay y `/applications`. No toca botones que escriban.

Sin secrets corre solo `/api/health` y el resto queda `skipped`. Para el recorrido con sesión, Admin crea:

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

- **Prender:** variable `POOL_SOURCE_COMPUTRABAJO_ALERTS=1` en Vercel (solo Admin). Cualquier otro valor es apagado. Hace falta `INGEST_DOMAIN`.
- **Crear las casillas:** no hay que crear nada en Resend; la dirección se usa como email de la alerta en el portal. El dominio de remitente aceptado está en `POOL_ALERT_SENDER_DOMAINS` (`packages/adapters/src/inbound/pool-mailbox.ts`); si el portal manda desde otro dominio o variante por país, se agrega ahí tras ver un email real.
- **Qué pasa hoy:** sin lector validado con emails reales, un email del portal a una casilla va a la cola manual del pool (fila de `inbound_emails` sin usuario, parser `pool_computrabajo_alerts`, `jobs_extracted` 0). No se extrae nada y no aparece en la bandeja de ninguna persona.
- **Rechazos:** interruptor apagado, otro remitente, carrera inexistente u otro dominio: no se guarda nada y el webhook responde como con un destinatario desconocido.
- **Si hay una `u_…` entre los destinatarios:** gana el flujo normal y el email no va al pool. Se decide primero por el sobre (`received_for`) cuando existe.
- **Topes de la cola:** 30 emails por hora y 200 por día (filas sin usuario con el parser del pool); pasados los topes se rechaza como destinatario desconocido, sin guardar, solo con un contador en el log. Un crudo de más de 256 KB guarda solo remitente, asunto y fecha.
- **Purga:** las filas del pool y su crudo se borran a los 30 días (la purga programada, solo `user_id IS NULL` y parser del pool).
- **Verla:** la cola del pool no tiene pantalla. Se mira solo con SQL (`inbound_emails` con `user_id IS NULL` y `parser = 'pool_computrabajo_alerts'`), que corre Admin.
- **Apagar:** quitar la variable o ponerla en `0`. Vale desde el siguiente email.
- **Migración:** el valor `computrabajo_alerts` de `source_kind` (0046) lo aplica Admin con `pnpm db:migrate` antes del merge.

## Qué cuenta (y qué no) en el gasto de IA

- **La demo semanal** (`/api/cron/demo`) tiene su tope propio (USD 1 cada 7 días) y suma al gasto de 24 h, pero no pasa por el tope global: no se frena si el global está lleno. Conviene correrla en la franja de menor uso.
- **Errores sin uso informado** (`validation`, `refusal`, `no_object*`, `aborted`) cuentan 0 si el proveedor no informó uso; con uso informado cuenta el costo real. Es una decisión registrada: una cuenta que provoca esos errores no gasta cupo, y el costo real queda en la factura del proveedor, no en el tope.
- **Sobrecarga del proveedor** (503, 529) tampoco estima gasto; timeout y otros 5xx estiman USD 0,04 por intento.
- **Corte de circuito:** con 5 fallas seguidas del proveedor en los últimos 10 minutos (`EVALUATE_MAX_CONSECUTIVE_FAILURES`), la evaluación inmediata no llama al modelo y la oferta queda para el cron.

## Alertas de gasto de IA (R7-1, R8-5)

Al pasar el 70, 85 y 95 % de `LLM_DAILY_CAP_USD` (gasto de 24 h) sale un email a **cada** admin de `ADMIN_EMAILS`, una vez por umbral, por destinatario y por día UTC. Sin migración: la marca es una fila `budget_alert` en `llm_calls` (label `<día>:<umbral>:<hash del email>`; las de R7-1, sin hash, valen para todos).

- **Cuándo se revisa:** en cada corrida del cron de evaluación (cada 6 h) **y** al terminar una evaluación fuera del cron (pegar aviso, reasignación por cambio de puesto). Esas revisiones usan un memo en memoria del proceso: con el umbral más alto ya entregado a todos no consultan nada, y si no, miran como mucho cada 5 minutos. **En serverless el memo es por instancia**: una instancia en frío consulta una vez más. Lo que garantiza «una vez por umbral, destinatario y día» es la marca en base (con lock de asesoría por día), no el memo.
- **Envío parcial:** se manda y recién después se anota, por destinatario. Si falla Resend para uno, no se anota y la próxima revisión reintenta solo a ese.
- **Si el proceso muere entre mandar y anotar:** la próxima revisión reenvía con la misma clave de idempotencia de Resend (`budget-alert:<día>:<umbral>:<hash del email>`), que Resend deduplica durante 24 h; no llega dos veces. La clave es por destinatario, no por posición en `ADMIN_EMAILS`.
- **Límite conocido:** el email que reenvía una alerta ya entregada pero sin anotar depende de esa ventana de 24 h de Resend. Para un reintento de otro día, la marca del día nuevo es otra y se manda de nuevo (es lo esperado: es otro día).

## Intentos de login (ADR-041)

La tabla `login_attempts` cuenta los intentos fallidos sin guardar el email ni la IP en claro: guarda un hash de cada uno.

- **`LOGIN_ATTEMPTS_HMAC_SECRET`** (opcional, recomendado en producción): con ella, los hashes del email y de la IP son un HMAC-SHA256; sin ella son sha256 sin sal, y quien lea la tabla puede comprobar si un email o una IP concretos intentaron entrar, o recorrer las 4000 millones de IPv4. Generarla con `openssl rand -base64 32` y cargarla en Vercel (prod). **Rotarla** deja huérfanas las filas con el hash anterior: se purgan solas al día siguiente y, mientras tanto, la espera de una cuenta empieza de cero. El restablecimiento de contraseña y el borrado de cuenta limpian con los dos hashes (el vigente y el sha256), así que cargarla por primera vez no deja filas colgadas.
- **Si falta en producción**, `/settings/salud` lo avisa (se decide con la variable, sin consultar la base).
- **Espera:** por email + IP, 5 intentos y espera creciente de 1, 2, 4… hasta 15 minutos. Por email solo (intentos repartidos en muchas IP), 50 intentos y después una espera que crece con cada intento de más: 1, 2, 4, 8 y 15 minutos como máximo. Ese contador **no vuelve a cero al vencer la espera**: se limpia con un login correcto, con el restablecimiento de contraseña o tras una hora sin intentos. Un ataque repartido en 10 IP durante 24 horas consigue unos 150 intentos evaluados contra la cuenta (lo fija un test), y la espera nunca pasa de 15 minutos seguidos. Restablecer la contraseña siempre destraba.
- **Purga:** la corrida de retención borra las filas con más de un día sin actividad. Corre en el cron de evaluación aunque el worker falle.

## Índices nuevos en tablas que crecen

Una migración que crea un índice sobre una tabla grande (`llm_calls`, `inbound_emails`, `raw_blobs`, `login_attempts`, `job_sources`, `jobs`) con `CREATE INDEX` común bloquea las escrituras de esa tabla mientras se construye. Hoy, con pocos datos, son milisegundos. Cuando la tabla tenga cientos de miles de filas:

- Usar `CREATE INDEX CONCURRENTLY IF NOT EXISTS`. No puede ir dentro de una transacción, y `db:migrate` corre cada archivo en una: se aplica a mano fuera de `db:migrate`, con el SQL revisado antes, y se verifica después con `pg_indexes`. `drizzle-kit` no lo genera y el SQL generado no se edita (`CLAUDE.md`); cómo llevar esos índices al repo se decide en un ADR nuevo antes del primero.
- Si el archivo corre en cada `db:migrate` (como los de `rls/`), preguntar antes por `pg_indexes` para no pedir el lock en cada corrida.
- Un índice `CONCURRENTLY` que falla deja un índice inválido (`indisvalid = false`): borrarlo con `DROP INDEX CONCURRENTLY` y repetir.
