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
| `LLM_DAILY_CAP_USD` | prod | tope global del worker en 24 h (default 2) |
| `LLM_USER_DAILY_CAP_USD` | prod | tope por usuario en 24 h, además del global (default 1; `0` = sin tope por usuario). Si un usuario lo pasa, sus evaluaciones quedan en la cola y las de otros siguen (JS-093). Un valor inválido (no numérico o negativo) hace fallar al worker. Exceso máximo posible: el chequeo es previo a cada llamada, así que con workers concurrentes (cron, pegar JD, CLI) un usuario puede pasarse por el costo de una evaluación por worker |
| `ADMIN_EMAILS` | prod | emails (separados por coma) que pueden crear invitaciones en `/settings/invitations` (JS-091). Vacía o sin definir: nadie |
| `POOL_SOURCES` | opcional | fuentes del pool global de ofertas públicas (JS-137), separadas por coma. **Sin definir o vacía: ninguna; el pool no consulta nada hasta que Mauro la define** (así el e2e y el CI no salen a la red). Valores: `getonboard`, `remoteok`, `jobicy`, `himalayas`, `wwr`, `greenhouse`, `lever`, `ashby`; las recomendadas son `getonboard,remoteok,jobicy,wwr,greenhouse,lever,ashby`, para prenderlas de a una después del `--dry-run` (ronda 47: `wwr` pasó acá desde `INGEST_EXTRA_SOURCES`; los tres ATS descargan los boards habilitados de `ats_boards`, sin boards no traen nada). **Himalayas queda apagada por sus términos** (`docs/sources/himalayas.md`). Un nombre desconocido se ignora con un warning. Para prender una fuente nueva, de a una: primero `pnpm pool:fetch <fuente> --dry-run` y recién después agregarla. Ver "Pool de ofertas públicas" abajo |
| `TARGET_ROLES_FREE_LIMIT` | opcional | cuántos puestos puede elegir una persona en el plan gratis (ADR-016). Default 2; entero de 1 a 13, cualquier otro valor usa el default. Lo pisa `profiles.max_target_roles` si no es null. Se valida en el servidor; la pantalla solo ayuda. Es una palanca de producto, no de costo: cada oferta se evalúa una sola vez y lo acotan los topes del pool. Bajar el tope (variable o `max_target_roles`) no recorta las listas ya guardadas: se corrigen cuando la persona vuelve a guardar. Migración 0020/0021: migrar y mergear seguido; si pasa tiempo entre `db:migrate` y el deploy, volver a correr el UPDATE de la 0021 después del deploy (es idempotente) |
| `POOL_BACKFILL_DAYS` | opcional | días hacia atrás que pide una fuente del pool en su primera corrida, cuando no tiene ninguna corrida `ok` previa. Default 14; entre 1 y 30 (nunca más que la retención del pool). Después, cada corrida pide desde la última `ok` menos 6 h de solapamiento. Si el presupuesto corta, la fuente queda `partial` y la próxima corrida sigue |
| `POOL_FIRST_ASSIGN_LIMIT` | opcional | ofertas del pool que se le asignan a una persona al terminar el onboarding. Default 30. Entero de 0 a 500; `0` apaga la asignación inicial. Vacía: usa el default. Inválida (no entera, negativa o mayor que 500): usa el default y el cron avisa con un warning que nombra la variable (nunca el valor) |
| `FIRST_EVAL_TOP_N` | opcional | cuántas de esas primeras ofertas se evalúan enseguida con el modelo (≈ USD 0,096 por usuario nuevo con el default). Default 9. Mismas reglas de valor; `0` = ninguna se evalúa al instante (quedan para el cron) |
| `POOL_DAILY_ASSIGN_LIMIT` | opcional | ofertas del pool nuevas que el cron le asigna a cada persona por día (ventana de 24 h, contando lo ya asignado). Default 20; `0` apaga la asignación diaria |
| `POOL_DAILY_EVAL_PER_USER` | opcional | evaluaciones que el cron encola por persona y día para ofertas del pool. Default 3; `0` = ninguna. La columna `profiles.pool_daily_eval_limit` pisa este valor para una persona si no es nula (ver abajo) |
| `INGEST_EXTRA_SOURCES` | opcional | fuentes extra que corre el cron de ingesta después de Get on Board y del pool, separadas por coma. **Vacía o sin definir por defecto: ninguna.** Valores: `torre` (Remote OK y Himalayas pasaron al pool: un `remoteok` o `himalayas` acá queda como desconocido con un warning; un nombre desconocido se ignora con un warning). **`wwr` salió de esta lista (ronda 47) y ahora va en `POOL_SOURCES`**: si todavía está acá se ignora con el aviso «wwr pasó al pool: sumala a POOL_SOURCES» y no rompe nada; sacalo de la variable cuando puedas. Prenderlas **de a una**, y tras la primera corrida revisar la sección `extraSources` de la respuesta del cron (`ok`, que es `false` si todas las prendidas fallaron, y por fuente `status` = `ok`/`partial`/`error`/`skipped`, `fetched`, `users`, `error`; un timeout figura como `error: "timeout"`) y los avisos ingeridos; qué mirar en cada una: `docs/sources/<fuente>.md`, "Cómo prenderla". Cada fuente tiene hasta 10 s de descarga (sin pasar lo que quede de los 100 s totales del request, que comparten Get on Board, el pool y las extras); agotados esos 100 s, las que faltan se omiten (`skipped: "presupuesto"`) y la que estaba ingiriendo queda `partial`. Una que falla no corta a las demás ni a Get on Board |
| `LLM_CALL_TIMEOUT_MS` | opcional | default 90000 |
| `LLM_DEMO` | preview | `1` para evaluar con el modelo falso (sin gasto) |
| `RESEND_WEBHOOK_SECRET`, `INGEST_DOMAIN` | bloque 4 | |
| `RESEND_API_KEY` | prod | también usada para mandar el email de "olvidé mi contraseña" (JS-045, ADR-012) |
| `EMAIL_FROM` | opcional | remitente del email de recuperación; vacío usa el sandbox `onboarding@resend.dev` |

## Pool de ofertas públicas (JS-137)

- **Qué corre:** el cron `/api/cron/ingest-getonboard` (cada 6 h, `maxDuration` 120 s) hace, en orden: (1) Get on Board por usuario, como siempre (salvo que `getonboard` esté en `POOL_SOURCES`); (2) el pool global con las fuentes de `POOL_SOURCES` (sin la variable no hace nada), con tope de 45 s; (3) mercado por rol y asignación del pool a cada persona; (4) `INGEST_EXTRA_SOURCES` con lo que quede. El presupuesto total es de 100 s medidos desde el inicio del request, y el pool corta entre avisos al agotarse. Cada fuente procesa como máximo 2000 avisos por corrida; si se recorta, queda `partial` (`truncated`). El pool guarda las ofertas en `public_jobs` (sin dueño, 30 días de retención) y lleva la bitácora en `public_job_fetches`.
- **Del pool a las personas (JS-138):** con `getonboard` en `POOL_SOURCES`, el cron **deja de correr la ingesta de Get on Board por usuario** (la reemplaza el pool) y la respuesta lo dice con `gob: "pool"`; sin `getonboard` en la variable sigue la ingesta por usuario de siempre (`gob: "por_usuario"`), así nadie queda sin ofertas mientras el pool está apagado. Si el pool insertó o actualizó avisos, el cron recalcula el mercado por rol (`roles` en la respuesta) y después asigna a cada persona hasta `POOL_DAILY_ASSIGN_LIMIT` ofertas nuevas, filtradas por su rol y su prefiltro (`assigned`: solo conteos de personas, asignadas, encoladas, descartadas, errores y si se frenó por tiempo). Cada paso tiene su propio manejo de errores: un fallo del pool o de la asignación no da 500 si lo demás anduvo. Al terminar el paso 1 del onboarding se asignan `POOL_FIRST_ASSIGN_LIMIT` ofertas sin evaluar; al salir de Mis skills se reemplazan las no tocadas y se evalúan en serie las primeras `FIRST_EVAL_TOP_N`; si aparece un tope de gasto se corta y el resto queda en la cola.
- **Tope de evaluaciones por persona (`pool_daily_eval_limit`):** columna de `profiles`, nula por defecto (rige `POOL_DAILY_EVAL_PER_USER`). Para cambiarla a una persona se usa un `UPDATE` puntual de esa fila, no el seed: `UPDATE profiles SET pool_daily_eval_limit = 5 WHERE user_id = '<id>'`. Lo corre Mauro, con el SQL revisado antes.
- **Primera corrida de cada fuente:** tarda más que las siguientes, porque trae el backfill inicial de `POOL_BACKFILL_DAYS` días; si no alcanza el presupuesto de 45 s, queda `partial` y la corrida siguiente continúa.
- **WWR y ATS públicos (ronda 47, migración 0024):** la 0024 suma `wwr`, `greenhouse`, `lever` y `ashby` al enum `source_kind` y crea `ats_boards` (RLS activo y sin policy, `rls/0005_ats_boards.sql`). La corre Mauro en Neon con el SQL revisado; para verificarla, `ops/rondas/47-fuentes-pool/sql/verificar-0024.sql` (solo lectura). `ats_boards` arranca **vacía**: la plantilla `sql/seed-ats.sql` trae un `INSERT … ON CONFLICT (provider, token) DO NOTHING` comentado por proveedor, con tokens de ejemplo inventados. Orden: (1) migrar y mergear; (2) probar cada fuente con `pnpm pool:fetch wwr --dry-run` y cada board con `pnpm pool:fetch <greenhouse|lever|ashby> <token> --dry-run`, sin escribir en la base; (3) cargar los boards que anduvieron; (4) sumar las fuentes a `POOL_SOURCES` de a una. `ats_boards.last_fetch_at` y `last_status` (código cerrado) muestran cuándo y cómo salió la última descarga de cada board.
- **Categorías nuevas de una fuente (ej. ronda 40, Get on Board):** `since` sale de la última corrida `ok`, así que solo traerían el último día. Después de sumarlas se reinicia la bitácora de la fuente (`reiniciar-backfill.sql`, lo corre Mauro con el SQL revisado) para que haga backfill; el dedup del pool absorbe lo repetido.
- **Intervalos:** cada fuente respeta un mínimo entre corridas (5 h para Get on Board, Remote OK y Jobicy; 23 h para Himalayas). Si la última corrida terminó en 429, el mínimo se duplica. Dentro del intervalo la fuente figura como `skipped: "intervalo"` y no deja fila.
- **Antes del deploy:** la migración 0018 (y `rls/0004`) se aplica en Neon con `pnpm db:migrate` (la corre Mauro) **antes del merge y del deploy, sin excepción**. Motivo: la migración agrega columnas a `jobs` y `profiles`, y cualquier consulta que lea esas tablas completas falla sin ellas, así que se cae toda la app, no solo el pool.
- **Probar una fuente sin escribir nada:** `pnpm pool:fetch <getonboard|remoteok|jobicy|himalayas> --dry-run` descarga una vez y muestra conteos y qué campos trae la respuesta real, sin imprimir títulos, empresas, URLs ni textos, y sin tocar la base.
- **Ver qué elegiría la asignación inicial, sin LLM y sin escribir:** `pnpm pool:explain --persona packages/adapters/src/pool/personas/lucia.json [--limit 30] [--db snapshot|dev] [--why "data analyst"]` (o `--user <uuid>`). Se conecta solo a la base local de Docker (`jobsearch_snapshot` por defecto, `--db dev` para `jobsearch`), en una transacción de solo lectura, y aborta si el host no es localhost. `--why` (repetible) dice en qué paso quedó afuera cada título que coincide.
- **Recalcular pistas e idioma (`pool:rehint`):** `pnpm pool:rehint [--apply] [--remote]` recalcula `role_hints` y `lang` de las ofertas vigentes del pool (sin copias, vistas en la ventana de `poolWindows`) con el código actual. El upsert solo corrige las ofertas que vuelven a aparecer, y Get on Board, Jobicy y Remote OK tienen ventana, así que las viejas no se corrigen solas. Correrlo después de cambiar las reglas de `role_hints` o la detección de idioma, **siempre primero sin `--apply`**: imprime antes/después por carrera e idioma y las transiciones de `producto_proyectos`, solo conteos, y no escribe. Con `--apply` hace un `UPDATE` por fila que cambió, solo de `role_hints` y/o `lang` (no toca `updated_at`, `last_seen_at` ni el crudo), en lotes de 500, y es idempotente. Local por defecto; `--remote` pide escribir «si» en una terminal y `CONFIRM_PRODUCTION` no la saltea.
- **Mirar la primera corrida:** en la respuesta del cron, la sección `pool` (`ok` y por fuente `status`, `fetched`, `inserted`, `updated`, `unchanged`, `copies`, `skipped` o `error` con un código cerrado: `timeout`, `http_429`, `http_4xx`, `http_5xx`, `parse`, `unknown`), y las filas de `public_job_fetches`. Una fuente que falla no corta a las demás ni a Get on Board.

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
   - `LLM_USER_DAILY_CAP_USD` = `1` · prod (opcional: sin ella rige el default 1)
   - `ADMIN_EMAILS` = el email de Mauro · prod (sin ella nadie puede invitar)
   - `LLM_DEMO` = `1` · solo preview (evaluaciones falsas, sin gasto)
   - `MCP_TOKEN` (`openssl rand -hex 32`) · prod: token del servidor MCP propio (JS-035)
   NO van: `DATABASE_URL_UNPOOLED` (solo migraciones locales), `DATABASE_URL_LOCAL`, `DATABASE_URL_APP_LOCAL`, `SEED_USER_*`, `DB_TARGET`, `LLM_FAKE_GENERATE`, `SKIP_APP_ROLE_CHECK`.

   **El build también lee la base (ronda 94).** Turborepo corre en modo estricto y solo le pasa a `next build` las variables de `turbo.json`. Por eso `DATABASE_URL_APP`, `CONTACT_EMAIL` y `SITE_URL` están en `passThroughEnv`: así la vitrina (`/`, `/mercado`, `/ofertas`, `/demo`, `/como-esta-hecho`) sale del build con datos y no con "Datos en preparación". El build (también el de Preview) lee el pool público con el rol de la app: `assertAppRole` corta si la URL es de un rol que puede saltear RLS, y la lectura va en una transacción `read only`. Si Neon no responde o falta una migración, **el build falla** y Vercel sigue sirviendo el deploy anterior: es fallar cerrado. Una variable nueva que necesite el build va en esa lista.
6. Deploy. Abrí `https://<app>/api/health`: tiene que responder `{"ok":true,"db":"ok"}`. Si responde 503 con `AppRoleError`, `DATABASE_URL_APP` apunta al rol equivocado.
7. Entrá con el email y la contraseña del paso 3; tiene que aparecer la lista de ofertas.

Cron:

8. En GitHub cargá la variable `APP_URL` con la URL del paso 6 (sin barra final).
9. Actions › cron › Run workflow (step: both). Tiene que terminar en verde y mostrar el JSON de la ingesta y de la evaluación. Si falla, el error dice cuál de los dos endpoints y por qué.
10. Al día siguiente: `pnpm llm:spend` y `/jobs` con ofertas nuevas de Get on Board.

## Variables de datos legales (JS-120)

Las páginas `/legal/privacidad` y `/legal/terminos` completan los datos legales desde variables de entorno, leídas en cada request (páginas dinámicas): cambiarlas en Vercel no exige rebuild, alcanza con redeployar. Se cargan en Vercel (Production y Preview); **nunca** van al repo y son públicas en esas páginas.

| Variable | Qué completa | Formato |
|---|---|---|
| `LEGAL_RESPONSABLE` | `[RESPONSABLE]` | Texto, hasta 200 caracteres |
| `LEGAL_DOMICILIO` | `[DOMICILIO]` | Texto, hasta 200 caracteres |
| `LEGAL_EMAIL` | `[EMAIL DE CONTACTO]` | Texto, hasta 200 caracteres |
| `LEGAL_LOG_DAYS` | Plazo de retención de los registros técnicos; también lo usa la purga (JS-107) | Entero de 1 a 3650 |

- **Si falta una variable** (o `LEGAL_LOG_DAYS` no es válido), la página dice "(dato en revisión)" o "un plazo que está en revisión", nunca el marcador.
- **Los valores se muestran como texto:** no se interpretan como Markdown ni como HTML, y no se loguean.
- **Sin `LEGAL_LOG_DAYS`,** la purga solo borra los tokens de reseteo vencidos.

## Rate limit de las pantallas de cuenta (JS-108)

Una regla del firewall de Vercel (Firewall › Rules): ventana fija de 10 pedidos por minuto por IP para los `POST` a `/login`, `/register`, `/setup`, `/forgot-password` y `/reset-password`. Cada intento de login o de registro cuesta un scrypt, así que sin esta regla son un vector de CPU y de fuerza bruta. Cargada el 2026-10-08. Si se agrega otra pantalla que reciba una contraseña, va en la misma regla.

## Email saliente para "olvidé mi contraseña" (JS-045): qué configura Mauro

No hace falta el dominio de ingesta ni nada de lo del bloque 4: alcanza con una cuenta de Resend
(plan free) y su API key.

1. Resend › API Keys → crear una y cargarla como `RESEND_API_KEY` en `.env.local` y en Vercel (prod). Si ya se cargó una para el bloque 4 (inbound), es la misma key: sirve para las dos cosas.
2. Sin un dominio propio verificado en Resend, dejar `EMAIL_FROM` vacío: el mail sale de `onboarding@resend.dev`, que **solo entrega al email con el que te registraste en Resend**. Si ese email no es el mismo que `SEED_USER_EMAIL`, "olvidé mi contraseña" va a fallar en silencio (el token se crea, el mail no llega) — usar el mismo email en ambos, o verificar un dominio propio en Resend y setear `EMAIL_FROM`.

## Email entrante con Resend (JS-020)

Dominio de ingesta: `ingest.malejo.com.ar`. Dirección de cada usuario: `u_<token>@ingest.malejo.com.ar` (se ve en Ajustes; es un secreto del usuario, no va en docs ni en issues).

**Hecho (2026-09-17):**

1. Resend › Domains › Add domain `ingest.malejo.com.ar`, y sus registros de **envío** cargados en la zona de Vercel (`npx vercel dns ls malejo.com.ar`): `send.ingest` MX `10 feedback-smtp.sa-east-1.amazonses.com.`, `send.ingest` TXT SPF y `resend._domainkey.ingest` TXT DKIM. Resuelven en 8.8.8.8.
2. Resend › Webhooks: endpoint `https://busquedalaboral.malejo.com.ar/api/inbound`, evento `email.received`. Su signing secret está en `RESEND_WEBHOOK_SECRET` (Vercel, producción). `RESEND_API_KEY` ya estaba (el webhook solo trae metadatos; el cuerpo se pide con `GET /emails/receiving/{id}`).
3. `INGEST_DOMAIN=ingest.malejo.com.ar` en Vercel y `profiles.inbound_address` actualizado con un **UPDATE puntual** (NO correr `pnpm db:seed` contra producción: reescribiría el perfil y el golden).
4. Verificado en producción: sin firma → 401; con firma inválida → 401; con firma válida y destinatario inexistente → 200 `unknown_recipient` sin escribir nada.

5. **Recepción habilitada:** recibir necesita un **MX aparte** del de envío, sobre `ingest.malejo.com.ar` (no sobre `send.ingest`) y con la prioridad más baja del subdominio: `ingest MX 10 inbound-smtp.sa-east-1.amazonaws.com`. Cargado con `npx vercel dns add malejo.com.ar ingest MX inbound-smtp.sa-east-1.amazonaws.com 10`. Resend no lo revalida solo: se fuerza con `POST https://api.resend.com/domains/<id>/verify` (con `RESEND_API_KEY`) y después `GET /domains/<id>` tiene que mostrar `status: verified` y el registro `Receiving` en `verified`.
6. **Reenvío de Gmail configurado** (2026-09-18): filtro que manda las alertas de LinkedIn y Get on Board a la dirección de ingesta del usuario, con las acciones «Reenviar a» y «Omitir Recibidos (archivarlo)». Gmail pide confirmar la dirección; **esta variante del mail no trae código, trae un link**, y llega al propio sistema. Desde la ronda 19 no hace falta marcar el dominio de Google como fuente de empleo: el pedido de confirmación (solo del remitente oficial de reenvíos de Gmail y dirigido a la dirección del usuario) se guarda completo y aparece arriba de todo en `/inbox`, con el botón «Confirmar reenvío». El botón es un link común (solo `https` a `mail.google.com` o `mail-settings.google.com`, calculado en el servidor sobre el cuerpo guardado; el servidor no abre nada). Si no hay un link válido, el bloque dice «Abrí el email para confirmarlo». «Ya lo confirmé» lo marca como visto. Si ese dominio ya se había marcado como empleo, se revierte en Ajustes › Remitentes («Sin decidir»).
7. Pendiente de comprobar con tráfico real: que una alerta de LinkedIn entre parseada (JS-021) y sus ofertas queden en pendientes de JD.

### Leer un email entrante

`/inbox` lista lo que llegó y cada fila linkea a `/inbox/<id>`, que muestra los links, el texto y el HTML del email (guardado en `raw_blobs`). El HTML va dentro de un `iframe` con `sandbox` vacío: es contenido no confiable, así que no se inyecta en la página. Sirve para decidir, cuando algo cae en cola manual, si se carga a mano o si conviene escribir un parser para esa fuente.

Límites del plan Free de Resend: 3.000 emails/mes, 100/día, retención 30 días (el crudo queda igual en `raw_blobs`, no depende de la retención).

## Servidor MCP propio (JS-035): cómo conectarlo desde Claude

Endpoint: `https://<app>/api/mcp` (Streamable HTTP, sin OAuth). Token compartido `MCP_TOKEN`, aceptado como `Authorization: Bearer <token>` o como `?token=<token>` en la URL. Herramientas: `list_pending_jd`, `list_jobs`, `get_job`, `set_status`, `paste_jd`, `add_job` (ingesta manual), `market_summary`, y para formularios de postulación (JS-053) `get_candidate_profile`, `list_answers`, `save_answer`, `save_application_answers`. Nunca postula ni navega LinkedIn: lee, cambia estados por `transition()`, recibe JD pegadas y guarda respuestas que la persona aprobó.
- **Hechos y respuestas fijas (JS-053):** no se editan por MCP. Después de migrar la 0015, `pnpm applicant:sync` (muestra el diff) y `pnpm applicant:sync --apply` (confirma con `si` contra Neon) desde `fixtures-private/applicant.json`.

- **Claude en el celular / claude.ai** (Settings › Connectors › Add custom connector): nombre `Job Search OS`, URL `https://<app>/api/mcp?token=<MCP_TOKEN>`, sin OAuth. El token viaja en la URL porque el conector no permite headers; queda en los logs de Vercel, por eso es rotable: cambiás `MCP_TOKEN` y volvés a cargar el conector.
- **Claude Code**: `claude mcp add --transport http job-search-os https://<app>/api/mcp --header "Authorization: Bearer <MCP_TOKEN>"`.
- **Claude Desktop**: mismo conector que claude.ai (Settings › Connectors), o `mcp-remote` con el header.
- Prueba rápida: `curl -H "Authorization: Bearer <MCP_TOKEN>" -H "content-type: application/json" -H "accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' https://<app>/api/mcp` devuelve las once herramientas; sin token, 401.

## Pasos (detalle)

1. Proyecto Vercel apuntando al repo, root directory `apps/web`, framework Next.js, `pnpm install` desde la raíz del monorepo (Vercel detecta el workspace).
2. Cargar las variables de la tabla. `DB_TARGET` no se define (la nube es el default fuera de `next dev`).
3. Migraciones: `pnpm db:migrate` contra `DATABASE_URL_UNPOOLED` antes del primer deploy y en cada PR que agregue migraciones (paso manual o job de Actions con el secret; `docs/TESTING_STRATEGY.md`). Aplica también `rls/0000_policies.sql`.
   - **Salvaguarda (2026-09-22):** contra una base remota, `db:migrate` y `db:seed` piden escribir `si` antes de tocar nada. Sin terminal (un agente o un script) no corren, salvo con `CONFIRM_PRODUCTION=si` explícito. Para la base local: `pnpm db:migrate:local` o `DB_TARGET=local`. Nació de una migración pensada para Docker que se aplicó en producción sin revisión (JS-048, migración 0013).
4. Seed del usuario: `SEED_USER_EMAIL=... SEED_USER_PASSWORD=... pnpm db:seed` (una vez; idempotente).
5. Deploy. `GET /api/health` responde `{ ok: true, db: "ok" }`; si el rol de `DATABASE_URL_APP` puede saltear RLS responde 503 con el motivo.
6. Cron según la opción elegida arriba.
7. Después del primer cron: `pnpm llm:spend` y la lista en `/jobs`.
