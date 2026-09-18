# Deploy (JS-019): Vercel + Neon

## Qué encontramos sobre el plan Hobby de Vercel (2026-09-11)

Fuente: [Usage & Pricing for Cron Jobs](https://vercel.com/docs/cron-jobs/usage-and-pricing) y [Functions Limits](https://vercel.com/docs/functions/limitations).

| | Hobby | Pro |
|---|---|---|
| Cron jobs por proyecto | 100 | 100 |
| Frecuencia mínima | **una vez por día** (una expresión más frecuente hace fallar el deploy) | cada minuto |
| Precisión | por hora: `0 1 * * *` dispara entre 1:00 y 1:59 | por minuto |
| Duración máxima de una función | 300 s (default y máximo) | 300 s default, 800 s máximo |

Consecuencia: el `vercel.json` actual (`0 */6 * * *` y `15 */6 * * *`) **no despliega en Hobby**. Opciones, a decidir:

1. **Un solo cron diario que ingesta y evalúa en la misma invocación** (`/api/cron/daily`: ingesta de GoB de las últimas 24 h y después el worker con `limit` 20, todo dentro de los 300 s). Un ciclo por día; lo pegado en "Pendientes de JD" se evalúa recién al día siguiente, salvo que se corra el worker a mano.
2. **Dos crons diarios separados** (`0 9 * * *` ingesta, `0 12 * * *` evaluación). Con la precisión por hora la evaluación puede correr hasta 3 h después; mismo ciclo diario.
3. **Cron externo desde GitHub Actions** (`schedule: "*/30 * * * *"` o cada 6 h) que llama a `/api/cron/ingest-getonboard` y `/api/cron/evaluate` con `Authorization: Bearer $CRON_SECRET`. Mantiene la frecuencia de 6 h (o más) sin pasar a Pro; los minutos de Actions de un repo privado alcanzan de sobra (cada corrida dura segundos). `vercel.json` queda sin `crons`.
4. **Pro** (USD 20/mes): crons por minuto. No se justifica hoy.

**Decisión (Mauro, 2026-09-11): opción 3.** No ata a Hobby, es el mismo patrón EventBridge → HTTP del ADR-007 (no es trabajo descartable) y el log de cada corrida queda visible en el repo. Implementado en `.github/workflows/cron.yml`: cada 6 h (00/06/12/18 UTC) llama a `/api/cron/ingest-getonboard` y después a `/api/cron/evaluate`; también se dispara a mano (`workflow_dispatch`, con el paso a elegir). **Falla ruidosamente**: cualquier respuesta no 2xx o sin `ok: true` deja el workflow en rojo y GitHub manda mail; el tope de gasto y las evaluaciones fallidas salen como `::warning`. `vercel.json` se eliminó (sin crons de Vercel). Desde el 2026-09-11 el mismo workflow tiene un segundo schedule, lunes 06:30 UTC, que llama a `/api/cron/market` (snapshot semanal de mercado + plan de formación, sin LLM); a mano: `workflow_dispatch` con `step = market`.

### Si algún día pasás a Pro: mover el cron a `vercel.json`

1. Crear `apps/web/vercel.json` con:
   ```json
   { "crons": [
     { "path": "/api/cron/ingest-getonboard", "schedule": "0 */6 * * *" },
     { "path": "/api/cron/evaluate", "schedule": "15 */6 * * *" }
   ] }
   ```
   Vercel manda `Authorization: Bearer $CRON_SECRET` solo: los endpoints no cambian.
2. Borrar `.github/workflows/cron.yml` (o dejarlo solo con `workflow_dispatch` como disparo manual).
3. Se pierde el log visible en el repo: las ejecuciones se ven en Vercel › Cron Jobs.

## Variables de entorno en Vercel

| Variable | Entorno | Origen |
|---|---|---|
| `DATABASE_URL` | prod + preview | Neon, pooled, rol dueño (crons y webhooks) |
| `DATABASE_URL_UNPOOLED` | solo el paso de migración | Neon, directa |
| `DATABASE_URL_APP` | prod + preview | Neon, pooled, rol `jobsearch_app` (la app; `assertAppRole` falla si no) |
| `AUTH_SECRET` | prod + preview (distinto por entorno) | `openssl rand -base64 32` |
| `CRON_SECRET` | prod | aleatorio; Vercel lo manda en `Authorization` a los crons |
| `GEMINI_API_KEY` | prod | proyecto de Google Cloud propio (docs/LLM_COSTOS.md) |
| `LLM_DAILY_CAP_USD` | prod | tope del worker en 24 h (default 2) |
| `LLM_CALL_TIMEOUT_MS` | opcional | default 90000 |
| `LLM_DEMO` | preview | `1` para evaluar con el modelo falso (sin gasto) |
| `RESEND_WEBHOOK_SECRET`, `INGEST_DOMAIN` | bloque 4 | |
| `RESEND_API_KEY` | prod | también usada para mandar el email de "olvidé mi contraseña" (JS-045, ADR-012) |
| `EMAIL_FROM` | opcional | remitente del email de recuperación; vacío usa el sandbox `onboarding@resend.dev` |

## Estado del deploy (2026-09-17)

| Qué | Valor |
|---|---|
| Proyecto Vercel | `job-search-os` (equipo `lizarraga-mauros-projects`), root `apps/web`, framework Next.js, Node 22 |
| Producción | `https://busquedalaboral.malejo.com.ar` (certificado Let's Encrypt emitido por Vercel). `https://job-search-os-kohl.vercel.app` sigue sirviendo la misma app en paralelo (ojo: `job-search-os.vercel.app` es de otro proyecto) |
| Git | repo `Malejo01/job-search-os` conectado: cada push a `main` despliega a producción |
| Variables | prod: `DATABASE_URL`, `DATABASE_URL_APP`, `AUTH_SECRET`, `CRON_SECRET`, `GEMINI_API_KEY`, `MCP_TOKEN`, `RESEND_API_KEY`, `LLM_DAILY_CAP_USD=2`; preview: `DATABASE_URL`, `DATABASE_URL_APP`, `AUTH_SECRET` + `LLM_DEMO=1` |
| GitHub | secrets `CRON_SECRET` y `GEMINI_API_KEY`; variable (no secret) `APP_URL=https://busquedalaboral.malejo.com.ar` |
| Base | Neon: migraciones hasta 0011 + policies, seed con el usuario real y el golden privado. Las migraciones NO corren en el deploy: después de mergear una, `pnpm db:migrate` a mano |

### DNS de malejo.com.ar (Vercel DNS)

Desde el 2026-09-17 el dominio completo está delegado en NIC.ar a `ns1.vercel-dns.com` / `ns2.vercel-dns.com`: los registros se manejan en Vercel (`npx vercel dns ls malejo.com.ar`), no en Hostinger. Registro del subdominio: `busquedalaboral CNAME cname.vercel-dns.com.` (además del wildcard `*` ALIAS por defecto). El apex y `www` los sirve el proyecto `portfolio-2026`.

**Lección del cambio de nameservers:** propagada la delegación, Vercel no activó la zona solo. Tenía el dominio como `serviceType: external` con los nameservers viejos cacheados y sus servidores respondían REFUSED, así que `malejo.com.ar` entero (portfolio incluido) quedó sin resolver ("lame delegation" en 8.8.8.8 y 1.1.1.1). Lo destrabó `MSYS_NO_PATHCONV=1 npx vercel api /v4/domains/malejo.com.ar/verify -X POST`, que pasó la zona a `zeit.world`. El certificado del subdominio tampoco se emitió solo: `npx vercel certs issue busquedalaboral.malejo.com.ar`. Si se vuelve a mover un dominio a Vercel DNS, verificar con DNS-over-HTTPS (`https://dns.google/resolve?name=<dominio>&type=A`) apenas propaga, sin esperar el aviso de Vercel.

## Checklist de Mauro (en orden, de una)

Local, antes de tocar Vercel:

1. **Antes de publicar**: `pnpm secrets:scan` (gitleaks sobre toda la historia; necesita Docker) tiene que terminar sin hallazgos. Después `git remote add origin <repo GitHub>` y `git push -u origin main` (los workflows `ci.yml` y `cron.yml` viven ahí; el job `secrets` repite el escaneo en cada push).
2. En GitHub › Settings › Secrets and variables › Actions: secret `CRON_SECRET` (generalo: `openssl rand -hex 32`; es el mismo valor que va a Vercel), secret `GEMINI_API_KEY` (opcional: solo para que los PRs corran evals), variable `APP_URL` (la URL de producción, la cargás después del paso 6).
3. Neon: `pnpm db:migrate` (usa `DATABASE_URL_UNPOOLED` de tu `.env.local`; ya está al día hasta 0009) y el seed del usuario, UNA vez, local: `SEED_USER_EMAIL=tu@email SEED_USER_PASSWORD=<contraseña> pnpm db:seed`. Esas dos variables NO van a Vercel.

Vercel:

4. New Project → importar el repo. Root Directory: `apps/web`. Framework: Next.js. Build y install por defecto (detecta pnpm workspace).
5. Environment Variables (Production, y Preview donde se indica):
   - `DATABASE_URL` (Neon pooled, dueño) · prod + preview
   - `DATABASE_URL_APP` (Neon pooled, rol `jobsearch_app`) · prod + preview
   - `AUTH_SECRET` (`openssl rand -base64 32`, distinto al de tu `.env.local`) · prod + preview
   - `CRON_SECRET` (el del paso 2) · prod
   - `GEMINI_API_KEY` (key del proyecto propio) · prod
   - `LLM_DAILY_CAP_USD` = `2` · prod
   - `LLM_DEMO` = `1` · solo preview (evaluaciones falsas, sin gasto)
   - `MCP_TOKEN` (`openssl rand -hex 32`) · prod: token del servidor MCP propio (JS-035)
   NO van: `DATABASE_URL_UNPOOLED` (solo migraciones locales), `DATABASE_URL_LOCAL`, `DATABASE_URL_APP_LOCAL`, `SEED_USER_*`, `DB_TARGET`, `LLM_FAKE_GENERATE`, `SKIP_APP_ROLE_CHECK`.
6. Deploy. Abrí `https://<app>/api/health`: tiene que responder `{"ok":true,"db":"ok"}`. Si responde 503 con `AppRoleError`, `DATABASE_URL_APP` apunta al rol equivocado.
7. Entrá con el email y la contraseña del paso 3; tiene que aparecer la lista de ofertas.

Cron:

8. En GitHub cargá la variable `APP_URL` con la URL del paso 6 (sin barra final).
9. Actions › cron › Run workflow (step: both). Tiene que terminar en verde y mostrar el JSON de la ingesta y de la evaluación. Si falla, el error dice cuál de los dos endpoints y por qué.
10. Al día siguiente: `pnpm llm:spend` y `/jobs` con ofertas nuevas de Get on Board.

## Email saliente para "olvidé mi contraseña" (JS-045): qué configura Mauro

No hace falta el dominio de ingesta ni nada de lo del bloque 4: alcanza con una cuenta de Resend
(plan free) y su API key.

1. Resend › API Keys → crear una y cargarla como `RESEND_API_KEY` en `.env.local` y en Vercel (prod). Si ya se cargó una para el bloque 4 (inbound), es la misma key: sirve para las dos cosas.
2. Sin un dominio propio verificado en Resend, dejar `EMAIL_FROM` vacío: el mail sale de `onboarding@resend.dev`, que **solo entrega al email con el que te registraste en Resend**. Si ese email no es el mismo que `SEED_USER_EMAIL`, "olvidé mi contraseña" va a fallar en silencio (el token se crea, el mail no llega) — usar el mismo email en ambos, o verificar un dominio propio en Resend y setear `EMAIL_FROM`.

## Email entrante con Resend (JS-020)

Dominio de ingesta: `ingest.malejo.com.ar`. Dirección del usuario: `u_a0000000@ingest.malejo.com.ar`.

**Hecho (2026-09-17):**

1. Resend › Domains › Add domain `ingest.malejo.com.ar`, y sus registros de **envío** cargados en la zona de Vercel (`npx vercel dns ls malejo.com.ar`): `send.ingest` MX `10 feedback-smtp.sa-east-1.amazonses.com.`, `send.ingest` TXT SPF y `resend._domainkey.ingest` TXT DKIM. Resuelven en 8.8.8.8.
2. Resend › Webhooks: endpoint `https://busquedalaboral.malejo.com.ar/api/inbound`, evento `email.received`. Su signing secret está en `RESEND_WEBHOOK_SECRET` (Vercel, producción). `RESEND_API_KEY` ya estaba (el webhook solo trae metadatos; el cuerpo se pide con `GET /emails/receiving/{id}`).
3. `INGEST_DOMAIN=ingest.malejo.com.ar` en Vercel y `profiles.inbound_address` actualizado con un **UPDATE puntual** (NO correr `pnpm db:seed` contra producción: reescribiría el perfil y el golden).
4. Verificado en producción: sin firma → 401; con firma inválida → 401; con firma válida y destinatario inexistente → 200 `unknown_recipient` sin escribir nada.

**Falta para recibir de verdad:**

5. Resend › el dominio › **Receiving / Enable receiving**: recibir necesita un **MX aparte**, distinto del de envío, sobre `ingest.malejo.com.ar` (no sobre `send.ingest`). Resend lo muestra al habilitarlo; tiene que quedar con la prioridad más baja del subdominio. Cargarlo con `npx vercel dns add malejo.com.ar ingest MX <valor> <prioridad>`.
6. En Gmail: filtro que reenvía las alertas (LinkedIn, Get on Board) a `u_a0000000@ingest.malejo.com.ar`. Gmail pide confirmar la dirección de reenvío: el mail de confirmación llega al webhook y queda en `/inbox` (cola manual) con el código.
7. Prueba final: mandar un mail cualquiera a la dirección; en `/inbox` aparece. Una alerta de LinkedIn tiene que entrar parseada (JS-021), no a la cola manual.

Límites del plan Free de Resend: 3.000 emails/mes, 100/día, retención 30 días (el crudo queda igual en `raw_blobs`, no depende de la retención).

## Servidor MCP propio (JS-035): cómo conectarlo desde Claude

Endpoint: `https://<app>/api/mcp` (Streamable HTTP, sin OAuth). Token compartido `MCP_TOKEN`, aceptado como `Authorization: Bearer <token>` o como `?token=<token>` en la URL. Herramientas: `list_pending_jd`, `list_jobs`, `get_job`, `set_status`, `paste_jd`, `add_job` (ingesta manual), `market_summary`. Nunca postula ni navega LinkedIn: lee, cambia estados por `transition()` y recibe JD pegadas.

- **Claude en el celular / claude.ai** (Settings › Connectors › Add custom connector): nombre `Job Search OS`, URL `https://<app>/api/mcp?token=<MCP_TOKEN>`, sin OAuth. El token viaja en la URL porque el conector no permite headers; queda en los logs de Vercel, por eso es rotable: cambiás `MCP_TOKEN` y volvés a cargar el conector.
- **Claude Code**: `claude mcp add --transport http job-search-os https://<app>/api/mcp --header "Authorization: Bearer <MCP_TOKEN>"`.
- **Claude Desktop**: mismo conector que claude.ai (Settings › Connectors), o `mcp-remote` con el header.
- Prueba rápida: `curl -H "Authorization: Bearer <MCP_TOKEN>" -H "content-type: application/json" -H "accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' https://<app>/api/mcp` devuelve las siete herramientas; sin token, 401.

## Pasos (detalle)

1. Proyecto Vercel apuntando al repo, root directory `apps/web`, framework Next.js, `pnpm install` desde la raíz del monorepo (Vercel detecta el workspace).
2. Cargar las variables de la tabla. `DB_TARGET` no se define (la nube es el default fuera de `next dev`).
3. Migraciones: `pnpm db:migrate` contra `DATABASE_URL_UNPOOLED` antes del primer deploy y en cada PR que agregue migraciones (paso manual o job de Actions con el secret; `docs/TESTING_STRATEGY.md`). Aplica también `rls/0000_policies.sql`.
4. Seed del usuario: `SEED_USER_EMAIL=... SEED_USER_PASSWORD=... pnpm db:seed` (una vez; idempotente).
5. Deploy. `GET /api/health` responde `{ ok: true, db: "ok" }`; si el rol de `DATABASE_URL_APP` puede saltear RLS responde 503 con el motivo.
6. Cron según la opción elegida arriba.
7. Después del primer cron: `pnpm llm:spend` y la lista en `/jobs`.
