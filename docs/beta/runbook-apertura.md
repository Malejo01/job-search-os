# Runbook de la apertura de la beta (jueves 26/11/2026)

Para Mauro, en orden. Cada paso trae el enlace o el comando exacto. Lo que dice «(solo Mauro)» toca producción y no lo hace ningún agente. Convenciones: la app vive en el proyecto de Vercel `job-search-os` (equipo `lizarraga-mauros-projects`), la base en Neon y el repo en `Malejo01/job-search-os`. `<dominio>` es `afiniajobs.com.ar` cuando esté activo (hasta entonces, `busquedalaboral.malejo.com.ar`).

> **Decidido y no se reabre acá.** La beta abre el jueves 26/11 para 6 carreras (abogacía, contaduría, administración, comunicación, marketing y RR.PP., relaciones internacionales). Cupo de 15 a 20 personas que pagan más 3 becadas, elegidas con criterios que define Ani. Plan Beta: ARS 20.000 por mes (USD 15 de referencia), 30 días por pago, **sin garantía**, activación manual. La gente se anota en `/acceso` y vos invitás desde el panel; **anotarse no garantiza lugar**.

## 0. Cronograma

| Fecha | Qué |
|---|---|
| 6/11 | Aprobación de marca (el cambio de nombre a AfinIAJobs espera esto) |
| 11/11 | Ani presenta la beta en Voces Jóvenes; la gente se anota con el QR (`/acceso?origen=voces-jovenes`) |
| 13/11 | Respuestas legales (términos y política de privacidad) |
| Del 12/11 en adelante | Invitaciones (vencen a los 14 días: invitar antes del 12/11 hace que vengan vencidas el 26/11) |
| 20 al 24/11 | Ensayo con testers (`docs/beta/ensayo-testers.md`) |
| **26/11** | **Apertura** |

## 1. Dos semanas antes (hasta el 12/11)

### 1.1 Mergear y migrar (solo Mauro)

1. **Mirá el PR de integración de la noche del 1/11** (rama `ronda/integracion-noche-1-11`): trae la tabla de PRs incluidos, la lista de migraciones y las «Decisiones para Mauro». Los PRs individuales no se cierran.
2. **Hacé un respaldo antes de migrar.** Neon › proyecto › *Branches* › *Create branch* (de la rama principal, ahora). Ponele de nombre `pre-beta-AAAA-MM-DD`. Es gratis y se borra después. Con la CLI de Neon, si la tenés: `neonctl branches create --name pre-beta-AAAA-MM-DD`.
3. **Revisá el SQL de cada migración** (están en `packages/db/drizzle/`, 0051 a 0055 más las policies de `packages/db/rls/`) y aplicá desde tu máquina, **antes del merge** (el código viejo ignora las columnas nuevas; el nuevo las necesita):

   ```bash
   pnpm db:migrate
   ```

   Pide escribir `si` en la terminal. Usa `DATABASE_URL_UNPOOLED` de tu `.env.local`. Nunca corras `pnpm db:seed` contra Neon: reescribe tu perfil y el golden.
4. **Merge en el orden del PR de integración** (con merge commit). Después del merge, Vercel despliega solo (entra a `main`).
5. **Comprobá el deploy:** `https://<dominio>/api/health` tiene que responder `{"ok":true,"db":"ok"}`.

### 1.2 Variables de Vercel (solo Mauro)

Vercel › `job-search-os` › Settings › Environment Variables, o por CLI (`npx vercel env add NOMBRE production --scope lizarraga-mauros-projects`; el valor lo pegás vos cuando lo pide, nunca en un chat). Listalas con `npx vercel env ls production --scope lizarraga-mauros-projects`. **Cambiar una variable de build pide un deploy nuevo** (Deployments › ⋯ › *Redeploy*).

| Variable | Valor | Para qué | Sin ella |
|---|---|---|---|
| `MP_LINK_LISTA` | el link de pago de Mercado Pago del plan Beta (ARS 20.000; `https://mpago.la/…`) | botón «Pagar con Mercado Pago» en `/precios` y «Tu plan», y en el email de aviso | no hay botón; se pide por email |
| `PRICING_ENABLED` | `1` (solo ese valor lo enciende) | muestra `/precios`, «Tu plan» y aplica los topes de cada plan | `/precios` da 404 y rigen los topes de siempre |
| `SITE_URL` | `https://afiniajobs.com.ar` (sin barra final) | links de emails, canonical, sitemap. De build | usa `AUTH_URL` o el dominio de Vercel |
| `LEGACY_HOSTS` | `busquedalaboral.malejo.com.ar` | redirige el dominio viejo (308), sin tocar `/api/*`. De build | no hay redirección |
| `AUTH_URL` | igual que `SITE_URL` | los links de invitación y de recuperar contraseña salen de acá | **las invitaciones salen con el dominio viejo** |
| `RESEND_API_KEY` | la key de Resend | reseteo de contraseña y avisos de vencimiento | no sale ningún email |
| `EMAIL_FROM` | `Nombre <no-reply@afiniajobs.com.ar>` (dominio **verificado** en Resend) | remitente | sin dominio verificado, Resend solo entrega a su dueño: **los reseteos fallan en silencio para el resto** y los avisos de vencimiento no se mandan |
| `CONTACT_EMAIL` | `contacto@afiniajobs.com.ar` | contacto en el pie y en los emails | no hay contacto |
| `ADMIN_EMAILS` | tu email (uno solo, ver `docs/seguridad/auditoria-beta-1-11.md` M-3) | quién ve los paneles y recibe los reportes de soporte | nadie administra |
| `MCP_USER_ID` | tu `users.id` (lo ves en Neon: `select id from users where email = '…'`) | con 2 o más cuentas el MCP falla cerrado sin esto | **el MCP de Claude deja de andar al registrarse la segunda persona** |
| `PLAN_NOTICE_DAILY_CAP` | `30` (opcional) | tope diario de avisos de «tu plan vence» | rige 30 |
| `WAITLIST_INVITE_CAP` | `20` (opcional) | tope por tanda del panel de invitaciones | rige 20 |
| `CV_CHAT_ENABLED` | `all` (opcional, ver 1.5) | abre «Armá tu CV con IA» a todas las cuentas | solo admins |
| `AREAS_FILTER_ENABLED` | **dejalo sin definir** | baja de orden las ofertas de otras áreas; se prende cuando decidas | las áreas guardan pero no filtran (el texto lo dice) |

También en **GitHub** › Settings › Secrets and variables › Actions › *Variables*: `APP_URL` = `https://<dominio>` (sin barra final). Los crons y el aviso de vencimiento le pegan a esa URL. Cuando cambies de dominio, es lo primero que hay que actualizar.

### 1.3 Cambio de dominio (solo Mauro, después del 6/11)

Seguí `docs/DEPLOY.md` › «Pasar a afiniajobs.com.ar» paso por paso (DNS en NIC.ar, dominio en Vercel, Resend verificado, webhook de Resend, `APP_URL`, `SMOKE_BASE_URL`). Probalo todo **antes** de invitar a nadie.

### 1.4 Probar los correos y los pagos (solo Mauro, una vez por cambio de dominio)

1. **Recuperar contraseña con una cuenta que NO sea la dueña de Resend** (una cuenta de prueba): `https://<dominio>/forgot-password`. Tiene que llegar el email con link al dominio nuevo. Si no llega: mirá Resend › *Emails* y la cuota diaria (plan gratis: 100 por día, compartida con los avisos y los reportes de soporte).
2. **Aviso de vencimiento, sin esperar tres días:**

   ```bash
   gh workflow run cron.yml --repo Malejo01/job-search-os -f step=plan-notices
   gh run list --workflow=cron.yml --repo Malejo01/job-search-os --limit 3
   ```

   Sin personas a punto de vencer responde `due: 0`. Si dice «faltan RESEND_API_KEY o EMAIL_FROM», falta una variable.
3. **Pago de prueba:** pagá vos mismo el link de `MP_LINK_LISTA` (o el monto mínimo del link de prueba) y verificá que aparece en Mercado Pago › *Actividad*. Después activá tu cuenta de prueba desde `/settings/planes` (ver 2.1).
4. **Botón «¿Algo no anduvo?»:** mandá un reporte de prueba y fijate que te llegue al email de `ADMIN_EMAILS` y que aparezca en `/settings/metricas`.

### 1.5 Opcionales

- **«Armá tu CV con IA» para todas las cuentas:** cargá en Neon las filas `cv_interview` y `cv_write` de `model_routing` (el SQL lo tenés vos), poné `CV_CHAT_ENABLED=all` y definí `CV_CHAT_DAILY_CAP_USD` a propósito (el default de USD 1 por día global lo agotan 3 o 4 cuentas activas). Tope por persona: 3 CV y 40 turnos por mes.
- **Monitores:** UptimeRobot o Better Stack sobre `https://<dominio>/api/health` (cada 5 min) y `https://<dominio>/api/cron/status` con `STATUS_TOKEN` (cada 30 a 60 min); detalle en `docs/MONITOREO.md`. Ojo: el monitor de status despierta la base cada vez (ver «Neon cerca del límite»).
- **Regla de firewall para `/acceso`** (Vercel › Firewall › Rules), si el 11/11 ves tráfico raro: 60 `POST` por minuto por IP. Las de `/login`, `/register` y `/forgot-password` ya existen (`docs/DEPLOY.md`, JS-108).

### 1.6 Elegir a quién invitar (solo Mauro, con Ani)

1. Abrí `https://<dominio>/settings/invitations`. Arriba de la lista de espera están los **contadores por carrera** («Abogacía 4 de 7», sin invitar de un total) y los filtros (carrera, cómo se enteró, fechas y estado).
2. **Ani pasa los criterios.** Hasta que estén, no invites: anotarse no es un lugar.
3. **Exportá la lista** (botón *Exportar a CSV*; solo nombre, email, carrera, origen y fecha) si Ani la quiere revisar en una planilla.
4. Marcá a quienes elegiste (casilla en cada fila, hasta 20 por tanda; el tope se puede cambiar en la pantalla), tocá **«Invitar a los seleccionados»** y confirmá.
5. **Copiá los mensajes ahora:** los links se muestran una sola vez. Cada mensaje dice que la beta abre el jueves 26/11 y que el link es personal. Mandalos por WhatsApp o email desde tu cuenta; el panel no manda nada.
6. Cada invitación **vence a los 14 días** y sirve una sola vez. Una que no se usó se revoca y se crea de nuevo desde la misma pantalla.
7. Cuando la persona se registra, **su carrera ya viene marcada** en el primer paso (la que eligió al anotarse); puede cambiarla.
8. Becados: se invitan igual; la beca se registra al activar el plan (ver 2.1).

## 2. El 26/11

### 2.1 Activar los planes (solo Mauro)

1. **Verificá el pago** en Mercado Pago › *Actividad* (o la transferencia). **No actives nada que no esté acreditado.**
2. Abrí `https://<dominio>/settings/planes`.
3. Escribí el **email con el que la persona se registró**, elegí en «Cómo llegó» **«Pagó»** o **«Becado»** y tocá **«Activar 30 días»**. Se suman **30 días** desde el último de: ahora, el 26/11 (la apertura) o la fecha en que ya vencía su plan. Un plan activado antes del 26/11 empieza a contar el 26/11. Renovar es la misma acción.
4. La lista de abajo muestra quién tiene plan, de qué origen y hasta cuándo, con los que vencen primero arriba.
5. Mensajes de error: «No encontramos a esa persona» = el email es otro o todavía no terminó el onboarding; «plan viejo» = tiene fundador o pase de 3 meses (se cambia a mano, `docs/OPERACION.md`).
6. Para **quitar** un plan (pasa a gratis sin borrar nada): botón **«Quitar el plan»** en la fila.

### 2.2 Avisos de vencimiento

Se mandan solos, una vez por persona, cuando le quedan 3 días o menos (cron diario de las 09:15 hora de Argentina). Los primeros salen recién el 23/12. Para ver qué pasó: Actions › workflow `cron` › paso «Aviso de planes por vencer»; la respuesta trae solo conteos (`due`, `sent`, `failed`, `skipped`).

### 2.3 Qué mirar ese día

| Dónde | Qué | Enlace o comando |
|---|---|---|
| App | salud | `https://<dominio>/api/health` |
| App | estado del evaluador y del pool | `curl -H "Authorization: Bearer $STATUS_TOKEN" https://<dominio>/api/cron/status` (los checks `queue_*` y `pool_freshness_hours`) |
| App | gente activa, 👍 y reportes | `https://<dominio>/settings/metricas` |
| Vercel | errores | proyecto `job-search-os` › *Logs* (filtro *Error*); *Deployments* para ver si el último está *Ready* |
| Vercel | consumo | *Usage* (invocaciones y ancho de banda) |
| Neon | transferencia y cómputo | consola de Neon › proyecto › *Monitoring* (*Network transfer*, *Compute hours*, *Storage*) y *Billing* para el límite |
| GitHub | crons y humo | Actions › `cron` y `smoke`; llegan mails si falla; issues `smoke-roto` |
| Costo de IA | gasto | `pnpm llm:spend --days 1` (si pasa de USD 1,5 en un día, mirá de quién es antes de subir el tope) |
| Resend | cuota de emails | Resend › *Emails* y *Usage* (100 por día en el plan gratis) |

## 3. Si algo falla

### 3.1 Neon cerca del límite de transferencia

Síntoma: aviso de Neon por email, la consola marca *Network transfer* cerca del tope del plan, o la app responde lento / con errores de conexión.

1. **Mirá cuánto y desde cuándo:** Neon › *Monitoring* y *Billing*. Compará con `docs/neon/auditoria-consultas.md` (las consultas que más transfieren: texto de los avisos del mercado por carrera, vitrina pública, candidatos de skills de `/market`).
2. **Frená lo que más consume, de a uno:**
   - Pausar los monitores externos de `/api/cron/status` (despiertan la base): desde UptimeRobot / Better Stack.
   - Pausar el cron entero (frena ingesta, evaluación y avisos) hasta tener claro el problema:

     ```bash
     gh workflow disable cron.yml --repo Malejo01/job-search-os
     # … después:
     gh workflow enable cron.yml --repo Malejo01/job-search-os
     ```

   - Bajar las fuentes del pool: sacar nombres de `POOL_SOURCES` en Vercel (después de redeployar no consulta esas fuentes).
3. **Aplicar el ahorro ya preparado** (PR «Ahorro de Neon, parte 1»: proyecciones de columnas y caché de páginas públicas) y, si no alcanza, subir el plan de Neon (Billing) mientras se resuelve.
4. Una vez pasado el apuro, repetí la medición de la ronda del 3/11 con `pg_stat_statements`.

### 3.2 Un deploy roto

Síntoma: Vercel muestra *Error*, la app da 500, `/api/health` responde 503.

1. **Volver atrás (lo primero, antes de investigar):** Vercel › `job-search-os` › *Deployments* › elegí el último deploy de **Production** que estaba *Ready* y andaba › ⋯ › **Promote to Production** (o *Instant Rollback*). Por CLI:

   ```bash
   npx vercel ls --scope lizarraga-mauros-projects
   npx vercel rollback --scope lizarraga-mauros-projects        # vuelve al anterior
   npx vercel promote <url-del-deploy-bueno> --scope lizarraga-mauros-projects
   ```

   En el plan Hobby puede que el panel solo ofrezca el deploy inmediatamente anterior; si necesitás uno más viejo, hacé `git revert -m 1 <commit-del-merge>` en una rama y mergeá ese PR.
2. **No reviertas la base.** Las migraciones de esta tanda solo agregan columnas, índices y funciones: el código anterior sigue andando con ellas. Si el problema es una migración, no la deshagas a mano: avisá y se arregla hacia adelante.
3. Mirá el error en Vercel › *Logs* (o `Runtime Logs` del deploy fallido). Si es una variable (falta `SITE_URL`, `AUTH_URL`…), corregila y redeployá.
4. Comprobá `https://<dominio>/api/health` y entrá con tu cuenta.
5. Abrí un issue con el error y el commit; el arreglo va en un PR.

### 3.3 Un pago que no aparece

1. Pedile a la persona **el comprobante** (captura de Mercado Pago o de la transferencia) y el **email con el que se registró**.
2. Buscalo en Mercado Pago › *Actividad* por monto, fecha y nombre. Los pagos a veces tardan en acreditarse; **no actives hasta que figure acreditado** (el plan es sin garantía y la activación es manual).
3. Si está acreditado, activá desde `/settings/planes` con el email de la cuenta (2.1). Si figura «No encontramos a esa persona», pagó con otro email: preguntale con cuál se registró (el panel busca por el email de la cuenta, no por el del pago).
4. Si pagó dos veces, activá una vez (suma 30 días) o dos (suma 60): son los días que pagó.
5. Nada se borra al vencer: si hay dudas, dejala activa hasta aclararlo.

### 3.4 Alguien que no puede entrar

| Qué pasa | Qué hacer |
|---|---|
| «El link no sirve» / «invitación vencida o usada» | En `/settings/invitations` revocá la anterior y creá una nueva atada a su email (desde la lista de espera o con el formulario) |
| Se olvidó la contraseña | Que use `https://<dominio>/forgot-password`. Si no le llega el email: revisá spam, Resend › *Emails* (¿rebotó?), la cuota de 100 por día y que `EMAIL_FROM` tenga el dominio verificado (3.5) |
| «Email o contraseña incorrectos» repetido | Probablemente un error de tipeo en el email del registro. Comprobá en Neon que el email existe: `select id, email from users where email ilike '%fragmento%';` |
| Dice «demasiados intentos» o no carga el formulario | El firewall de Vercel corta a 10 pedidos por minuto por IP en `/login`, `/register` y `/forgot-password` (wifi compartido). Esperar un minuto |
| Entra pero lo manda a «Términos actualizados» u «Onboarding» | Es el flujo normal: aceptar los términos / completar el perfil |
| Entra pero no ve su carrera | Que la elija en el paso 1; si no está en la lista, es un bug (hay que avisar) |
| El plan figura vencido | Entra igual (rige el plan gratis); se renueva desde `/settings/planes` |
| Se registró dos veces con emails distintos | Dejalo; si pide que se borre una cuenta: Ajustes › Cuenta, o `pnpm admin:test-users --reset <email>` solo si está en tu allowlist |

### 3.5 No salen emails

1. Resend › *Emails*: ¿hay errores de dominio no verificado? Entonces `EMAIL_FROM` apunta a un dominio sin verificar (verificar en Resend › *Domains*) o está vacío (sandbox).
2. ¿Cuota del día agotada (100)? Los reportes de soporte, los reseteos y los avisos comparten el cupo. Bajá `PLAN_NOTICE_DAILY_CAP` y dejá una sola dirección en `ADMIN_EMAILS`.
3. Probá el reseteo con una cuenta que no sea la dueña de Resend (1.4).

### 3.6 La lista de espera no deja anotarse

Síntoma: «hay muchos pedidos» a varias personas desde el mismo lugar. La base corta a 40 pedidos por hora por IP, 60 cada 10 minutos y 600 por día. Si Ani espera más gente en el mismo salón, subí las constantes de `waitlist_join` en `packages/db/rls/0006_waitlist.sql` (PR chico) y aplicá `pnpm db:migrate`.

### 3.7 El MCP o Claude no ven tus datos

Con dos o más cuentas, el MCP necesita `MCP_USER_ID` (1.2). Probá con `curl -H "Authorization: Bearer $MCP_TOKEN" -H "content-type: application/json" -H "accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' https://<dominio>/api/mcp`.

## 4. Checklist de una página

- [ ] Respaldo de Neon creado (`pre-beta-…`)
- [ ] `pnpm db:migrate` aplicado y revisado; merge hecho; `/api/health` ok
- [ ] Variables de Vercel cargadas (1.2) y `APP_URL` en GitHub
- [ ] Dominio nuevo andando y probado (1.3); webhook de Resend apuntando al dominio nuevo
- [ ] Reseteo de contraseña probado con una cuenta ajena; reporte de soporte probado
- [ ] `MP_LINK_LISTA` y `PRICING_ENABLED=1`; `/precios` carga; pago de prueba hecho
- [ ] Criterios de Ani recibidos; invitaciones enviadas desde el 12/11
- [ ] Ensayo del 20 al 24/11 hecho y hallazgos resueltos
- [ ] Monitores creados; Neon y Vercel abiertos el 26/11
