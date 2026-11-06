# Pasos manuales de la tanda R4 (para Mauro)

Fecha: 2026-11-06. Todo lo de acá lo hacés vos: ningún agente toca Vercel, Neon, DNS ni cuentas externas. Cada sección trae: qué es, los pasos con el link del panel, los valores exactos, cómo verificar que quedó bien y cuánto tarda. Los valores salen del código y de los docs del repo; lo que no está en ninguno dice «A confirmar».

**Para el 11/11: §1 y §2.** El resto puede esperar a después del evento.

Convenciones: `<dominio>` es `afiniajobs.com.ar` (hasta que migre, `busquedalaboral.malejo.com.ar`). El proyecto de Vercel es `job-search-os`, equipo `lizarraga-mauros-projects` (como en `docs/beta/runbook-apertura.md`). Comandos de `pnpm`: desde la raíz del repo, en tu máquina.

## Índice

1. Variables de C8 en Vercel
2. Regla de firewall para `POST /acceso`
3. Ruteo de modelos en Neon (`evaluate_job` y filas del CV)
4. PR #392: evaluar ofertas cada hora
5. Exportar 2 o 3 alertas de Computrabajo a `fixtures-private/`
6. Verificar que la cola del pool reciba alertas
7. Casilla de contacto del producto reenviada al Gmail
8. Fuentes The Muse y ReliefWeb
9. Costos: lo que falta confirmar
10. PRs viejos abiertos (#347, #308, #69)
11. Links de pago con descuento en Mercado Pago
12. Prender el agente conversacional para Mauro y Ani (R4-15)
13. Fila `assistant_chat` en `model_routing` (R4-17)

---

## §1. Variables de C8 en Vercel

**Qué es.** La tanda C8 dejó funciones nuevas apagadas detrás de variables. Acá las prendés en orden, cargás la ventana del evento y rellenás el idioma del pool. Fuente: `docs/beta/tanda-c8.md`, «Variables nuevas».

**Antes de empezar (importante).** Las migraciones 0057 a 0059 tienen que estar aplicadas en Neon **antes** de que se despliegue el código de C8, aunque las variables estén apagadas (Drizzle escribe todas las columnas del schema). Si ya mergeaste y migraste, seguí. Si no, mirá `docs/beta/runbook-apertura.md` §1.1 (respaldo, `pnpm db:migrate`, merge). Migrá con `pnpm db:migrate` y no de otra forma: además de las migraciones aplica las funciones de `packages/db/rls/*.sql` (entre ellas `waitlist_join_event`, con los topes del evento); sin eso la ventana del 11/11 no tiene efecto.

**Pasos.**

1. Abrí https://vercel.com/lizarraga-mauros-projects/job-search-os/settings/environment-variables (Dashboard › proyecto `job-search-os` › Settings › Environment Variables).
2. Por cada fila de la tabla de abajo: **Add Environment Variable**, nombre, valor, entorno **Production**, **Save**. El valor lo pegás vos.
3. **Solo `WAITLIST_EVENT_WINDOW`**: cargala el 10/11 o el mismo 11/11 antes del evento, con el horario real (ver el formato abajo).
4. Si existe `MOBILE_TABBAR_ENABLED`, borrala (los tres puntos de la fila › **Delete**). Ya no se usa desde C9-7 (las pestañas de abajo van siempre en el celular).
5. Cuando termines: Deployments › el último de Production › ⋯ › **Redeploy**.
6. Cuando `PUBLIC_JOBS_LANGUAGE_ENABLED=1` ya esté en producción, corré el relleno de idioma (comandos abajo).

**Valores exactos** (todos «apagados por defecto»; sin la variable, la función no existe):

| Variable | Valor | Cuándo | Ticket |
| --- | --- | --- | --- |
| `ACCESO_FUNNEL_ENABLED` | `1` | después de aplicar la 0057 | C8-2 |
| `WAITLIST_EVENT_WINDOW` | ver «Formato» abajo | solo el 11/11 | C8-3 |
| `START_HERE_ENABLED` | `1` | cuando quieras | C8-5 |
| `HELP_TIPS_ENABLED` | `1` | cuando quieras | C8-6 |
| `WELCOME_EMAIL_ENABLED` | `1` | **no la prendas** hasta decidir el presupuesto de Resend (S-3, `docs/seguridad/auditoria-beta-3-11.md`) | C8-7 |
| `PUBLIC_JOBS_LANGUAGE_ENABLED` | `1` | después de aplicar la 0058 | C8-15 |
| `MARKET_CANDIDATES_ENABLED` | `1` | después de aplicar la 0058 | C8-15 |
| `FEEDBACK_TRIAGE_ENABLED` | `1` | después de aplicar la 0059 | C8-17 |
| `LEGAL_FINAL` | dejala **vacía** | `1` solo para el chequeo final (`pnpm legal:check`); no cambia la app | C8-12 |
| `MOBILE_TABBAR_ENABLED` | **borrarla** | ya no se usa | R-3 |

**Formato exacto de `WAITLIST_EVENT_WINDOW`** (`packages/pipeline/src/waitlist-event.ts`): `inicio/fin`, los dos en ISO 8601 **con zona explícita** (`Z` o `±hh:mm`), separados por una barra, sin espacios. Si no cumple el formato, la duración es 0 o negativa, o supera **12 horas**, el sistema la ignora (falla cerrado: rigen los topes normales). Ejemplo con el horario de la tanda (reemplazalo por el horario real que pongas vos; son 2 a 3 horas):

```
2026-11-11T19:00:00-03:00/2026-11-11T22:00:00-03:00
```

Solo vale para pedidos que vengan con `?origen=voces-jovenes` (el QR). Dentro de la ventana rigen 120 por IP por hora y 200 cada 10 minutos; el tope diario sigue en 600.

**Relleno del idioma del pool** (C8-15). Son dos comandos, y los dos van **contra Neon** (`--remote` pide escribir `si` en la terminal). Primero el conteo, que no escribe nada:

```bash
pnpm pool:backfill-language --remote
```

Muestra `pendientes antes: N` y «nada escrito: agregá --apply». Después, escribir:

```bash
pnpm pool:backfill-language --remote --apply
```

Es idempotente (solo toca las filas con `language_checked_at` vacío o anterior a `updated_at`), se puede repetir. Fuente: `packages/adapters/src/pool/backfill-language-cli.ts`.

**Cómo verificar.**

- En el panel de variables: las nuevas aparecen en Production y `MOBILE_TABBAR_ENABLED` ya no (no pegues valores en chats).
- `https://<dominio>/api/health` responde `{"ok":true,"db":"ok"}`.
- `ACCESO_FUNNEL_ENABLED`: entrá a `https://<dominio>/acceso?origen=voces-jovenes` y después a `/settings/metricas`: aparece el embudo con una visita.
- `START_HERE_ENABLED` y `HELP_TIPS_ENABLED`: «Empezá acá» en `/hoy` y los «¿Qué es esto?» en el puntaje.
- Idioma: después del `--apply`, repetí el comando sin `--apply`: tiene que decir `pendientes antes: 0` (o un número chico, si entre medio se actualizaron avisos).

**Cuánto tarda.** 10 a 15 minutos las variables y el redeploy; el relleno de idioma, unos minutos según cuántas filas haya (A confirmar: el conteo lo da el primer comando).

---

## §2. Regla de firewall para `POST /acceso`

**Qué es.** Hallazgo S-2 de `docs/seguridad/auditoria-beta-3-11.md`: `/acceso` recibe pedidos públicos sin tope propio (el embudo y el formulario). Una regla del firewall de Vercel corta a quien mande demasiados `POST` desde la misma IP, sin frenar a la sala del 11/11.

**Cuentas para elegir el número.** En el evento, todo el salón entra por un solo wifi, o sea **una IP**. Cada persona genera varios `POST` a `/acceso` (las acciones del servidor: `visita`, `empezado`, una o más `carrera` y `enviado`; ver `apps/web/app/(public)/acceso/actions.ts`): estimo hasta **5 a 8 por persona**. 30 personas en el mismo minuto serían unos 150 a 240; 60 personas, unos 300 a 480, pero repartidas en varios minutos. La auditoría ejemplifica con 120 por minuto, que **corta a una sala de 30 personas si se anotan todas juntas**. Por eso propongo:

| | Valor |
| --- | --- |
| Condiciones (todas deben cumplirse) | **Request Path** igual a `/acceso` **y** **Method** igual a `POST` |
| Algoritmo | **Fixed Window** (el único de Hobby y Pro) |
| Ventana | **60 s** |
| Límite | **300 pedidos** |
| Clave | **IP** |
| Acción | **Default (429)** |

Esto frena a un script (más de 300 por minuto, o sea 5 por segundo, sostenido) y deja pasar a 60 personas anotándose casi a la vez. El tope de la base (120 altas por IP por hora en el evento) sigue protegiendo la lista de espera por su lado. Cuenta de seguridad: la regla es contra abuso masivo, no contra el uso humano. **Después del evento** podés bajarla a **120 por minuto** (valor de la auditoría) o a 60 (valor del runbook §1.5), porque ya no hay una sala detrás de una sola IP.

**Pasos.**

1. Abrí https://vercel.com/lizarraga-mauros-projects/job-search-os/firewall (proyecto › **Firewall** en la barra lateral).
2. **Configure** (arriba a la derecha) › **+ New Rule**.
3. Nombre: `acceso-post-por-ip`.
4. En **Configure › If**: agregá la condición **Request Path** *Equals* `/acceso`, y otra **Method** *Equals* `POST`.
5. En **Then**: elegí **Rate Limit**. Si es la primera vez, leé el cuadro de precios y **Continue**.
6. Estrategia **Fixed Window**; **Time Window** `60` s; **Request Limit** `300`; clave **IP**; acción **Default (429)**.
7. **Save Rule**. Arriba aparece **Review Changes** › revisá › **Publish**.

**Aviso sobre el plan.** Según https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting (consultada el 2026-11-06): en **Hobby** hay **1 regla de rate limit por proyecto**; en Pro, 40. El runbook (§3.4) dice que ya hay reglas de 10 por minuto en `/login`, `/register` y `/forgot-password`. **Si estás en Hobby y esas reglas ya usan el único lugar, no vas a poder crear esta**: A confirmar cuántas reglas de rate limit tenés hoy (Firewall › Configure). Opciones: pasar a Pro (los costos de `docs/beta/costos-por-usuario.md` ya lo prevén al cobrar), o ampliar la regla existente. Además, los contadores son por región: el límite real puede ser algo mayor que el configurado.

**Cómo verificar.**

1. Desde tu compu, con la regla publicada:

   ```bash
   for i in $(seq 1 320); do curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<dominio>/acceso; done | sort | uniq -c
   ```

   Esperado: unos 300 respuestas de otro código (4xx/2xx de la app, no 429) y el resto `429`. Tu IP queda limitada solo durante 60 s.
2. Firewall › **Overview**: en el desplegable de tráfico elegí tu regla y mirá que registró los pedidos denegados.
3. Entrá al formulario `https://<dominio>/acceso?origen=voces-jovenes` desde el celular con datos móviles y anotá a un tester: tiene que funcionar normal.

**Cuánto tarda.** 10 minutos. Hacelo antes del 10/11 para tener margen de probar.

---

## §3. Ruteo de modelos en Neon

**Qué es.** La tabla `model_routing` decide qué modelo usa cada tarea; cambiar de modelo es un `UPDATE` y no necesita deploy (la app cachea cada ruta 5 minutos: `packages/adapters/src/llm/router.ts`). Hay que decidir si `evaluate_job` sigue con Gemini o pasa a Claude, y asegurarse de que estén las filas del CV si prendés `CV_CHAT_ENABLED=all`. **Nunca corras `pnpm db:seed` contra Neon** (reescribe tu perfil y el golden): para cambiar un dato va un `UPDATE` puntual, como acá.

### 3.1 Estado según el repo

Fuente: `packages/db/seeds/model_routing.json` (lo que dice el repo; **lo que hay en Neon puede diferir**, ver 3.2). Columnas de la tabla: `task`, `provider`, `model`, `fallback_model`, `temperature`, `max_tokens`, `thinking_level`, `input_usd_per_mtok`, `output_usd_per_mtok`, `fallback_input_usd_per_mtok`, `fallback_output_usd_per_mtok`, `updated_at` (`packages/db/schema.ts`).

| task | modelo principal | respaldo | temp | max_tokens | thinking |
| --- | --- | --- | --- | --- | --- |
| `evaluate_job` | gemini-3.5-flash (1,5 / 9) | claude-haiku-4-5 (1 / 5) | 0 | 2048 | minimal |
| `extract_skills` | gemini-3.5-flash | claude-haiku-4-5 | 0 | 4096 | minimal |
| `parse_email_fallback` | gemini-3.1-flash-lite (0,25 / 1,5) | ninguno | 0 | 1024 | minimal |
| `judge_calibration` | claude-sonnet-5-5 (2 / 10) | ninguno | 0 | 2048 | null |
| `recruiter_message` | claude-sonnet-5-5 | gemini-3.5-flash | 0,4 | 800 | null |
| `draft_application_answers` | claude-sonnet-5-5 | gemini-3.5-flash | 0,4 | 2048 | null |
| `cv_interview` | gemini-3.5-flash | claude-haiku-4-5 | 0 | 1024 | minimal |
| `cv_write` | gemini-3.5-flash | claude-sonnet-5-5 (2 / 10) | 0,3 | 3000 | minimal |
| `skill_interview` | claude-sonnet-5-5 | gemini-3.5-flash | 0,3 | 1500 | null |

`assistant_chat` **no** tiene fila (ver §13).

### 3.2 Mirar el estado real primero (solo lectura)

Va contra Neon. Ojo: `pnpm db:sql` **no** es de solo lectura (ejecuta cualquier sentencia con la conexión dueña); acá solo lee porque la consulta es un `select`. Copiala tal cual:

```bash
pnpm db:sql "select task, provider, model, fallback_model, temperature, max_tokens, thinking_level, input_usd_per_mtok, output_usd_per_mtok, fallback_input_usd_per_mtok, fallback_output_usd_per_mtok, updated_at from model_routing order by task"
```

La nota de Notion del 1/11 dice que `cv_interview` y `cv_write` ya se cargaron y que `evaluate_job` está con Gemini (30 de 31 llamadas OK). Si el resultado coincide, **las filas del CV ya están y no hace falta el SQL 3.4**.

### 3.3 Opciones para `evaluate_job`

Costos por evaluación (de `docs/beta/costos-por-usuario.md` §3.1, prompt `evaluate_job@v1.3.4`, aviso de 2 / 4 / 10 KB):

- **A. Seguir con Gemini 3.5 Flash (minimal):** el costo medido por evaluación está en `docs/beta/costos-por-usuario.md` §3.1 (aviso bajo, medio y alto).
- **B. Pasar a Claude Sonnet 5.5, thinking `low`:** sin medir. `docs/adr/025-haiku-tareas-de-volumen.md` (ampliación C-26) dice que cuesta «alrededor del doble que Gemini Flash por evaluación». O sea, el gasto de evaluaciones por persona del doc de costos (§4) se duplica aproximadamente, y en uso alto pasa el precio del plan; lo frena `LLM_USER_DAILY_CAP_USD` (USD 1 por día).

**A confirmar: no hay medición real de Sonnet con v1.3.4**; se confirma con `pnpm llm:spend --days 7` después de unos días.

Qué dice el repo para decidir (`docs/adr/025-haiku-tareas-de-volumen.md`): «la decisión no cambia: Gemini sigue como principal»; Sonnet 5.5 con thinking bajo pasó disciplina, descartes y ubicación y quedó **a un caso de 18 del umbral de acción**; es la alternativa más cercana si se quieren usar créditos de Anthropic. Requisitos de B:

- `ANTHROPIC_API_KEY` cargada en Vercel (A confirmar si ya está; sin ella el principal no corre y cae al respaldo).
- **Con thinking, `max_tokens` tiene que ser 8192 o más**; con 2048 el thinking se come el presupuesto y el JSON sale cortado. Por eso el SQL de B pone 8192.
- Tarifas de Sonnet (2 / 10) y de Gemini como respaldo (1,5 / 9): son las del seed.

**Mi lectura (decide vos):** A es lo medido y lo que anda hoy en producción; B cuesta el doble y quedó a un caso del umbral. Para la apertura del 26/11, A. B queda como plan si Google tiene problemas de cuota. Los dos SQL están abajo; el de A también sirve para **volver atrás** de B.

### 3.4 SQL (guardalos como archivos `.sql` en Descargas)

Reglas de `packages/db/src/run-sql-file.ts`:

- El archivo tiene que **empezar con `BEGIN;`** (se aceptan líneas de comentario `--` antes) y **terminar exactamente en `COMMIT;`** (sin nada después, ni siquiera comentarios).
- `--ensayo` cambia el `COMMIT;` final por `ROLLBACK;`: corre todo, incluidas las guardas, y no deja nada. Sin `--ensayo` aplica de verdad y, contra una base remota, pide escribir `si`.
- Sin `--local` va contra **Neon** (conexión dueña). Con `--local`, contra Docker. Usá la **ruta completa** al archivo, porque `pnpm --filter … exec` corre desde `packages/db`.
- Los números `real` se comparan con `::real` (si no, `0.3` no es igual a `0.3::real`).

Comando (cambiá `<usuario>` por tu usuario de Windows y el nombre del archivo):

```bash
# 1) Ensayo: no deja nada. Tiene que terminar con "OK: el ensayo corrió entero y la guarda pasó."
pnpm --filter @job-search-os/db exec tsx src/run-sql-file.ts --file "C:/Users/<usuario>/Downloads/<archivo>.sql" --ensayo

# 2) Aplicar de verdad (pide escribir si)
pnpm --filter @job-search-os/db exec tsx src/run-sql-file.ts --file "C:/Users/<usuario>/Downloads/<archivo>.sql"
```

Los dos comandos tocan Neon (el ensayo también corre contra Neon, pero termina en `ROLLBACK`). **Primero siempre el ensayo.** Después, esperá hasta 5 minutos por el caché de rutas.

**Archivo `evaluate-job-a-gemini.sql`** (opción A; deja `evaluate_job` como en el seed y sirve para volver atrás):

```sql
-- evaluate_job: Gemini 3.5 Flash minimal, respaldo Haiku 4.5 (valores de packages/db/seeds/model_routing.json)
BEGIN;

DO $$
BEGIN
  IF (SELECT count(*) FROM model_routing WHERE task = 'evaluate_job') <> 1 THEN
    RAISE EXCEPTION 'evaluate_job: se esperaba exactamente una fila en model_routing';
  END IF;
END $$;

UPDATE model_routing SET
  provider = 'google',
  model = 'gemini-3.5-flash',
  fallback_model = 'claude-haiku-4-5',
  temperature = 0::real,
  max_tokens = 2048,
  thinking_level = 'minimal',
  input_usd_per_mtok = 1.5::real,
  output_usd_per_mtok = 9::real,
  fallback_input_usd_per_mtok = 1::real,
  fallback_output_usd_per_mtok = 5::real,
  updated_at = now()
WHERE task = 'evaluate_job';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM model_routing
    WHERE task = 'evaluate_job'
      AND provider = 'google' AND model = 'gemini-3.5-flash'
      AND fallback_model = 'claude-haiku-4-5'
      AND temperature = 0::real AND max_tokens = 2048 AND thinking_level = 'minimal'
      AND input_usd_per_mtok = 1.5::real AND output_usd_per_mtok = 9::real
      AND fallback_input_usd_per_mtok = 1::real AND fallback_output_usd_per_mtok = 5::real
  ) THEN
    RAISE EXCEPTION 'evaluate_job: la fila no quedó como se esperaba';
  END IF;
END $$;

COMMIT;
```

**Archivo `evaluate-job-b-sonnet.sql`** (opción B; solo corre si hoy está en el estado del seed, o sea con Gemini como principal; si no, la guarda frena y te muestra que primero hay que mirar la fila con la consulta de 3.2):

```sql
-- evaluate_job: Claude Sonnet 5.5 con thinking low, respaldo Gemini 3.5 Flash.
-- max_tokens 8192: con thinking hace falta 8192 o más (docs/adr/025, ampliación C-26).
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM model_routing
    WHERE task = 'evaluate_job'
      AND provider = 'google' AND model = 'gemini-3.5-flash'
  ) THEN
    RAISE EXCEPTION 'evaluate_job: hoy no tiene Gemini 3.5 Flash como principal; mirá la fila antes de cambiarla';
  END IF;
END $$;

UPDATE model_routing SET
  provider = 'anthropic',
  model = 'claude-sonnet-5-5',
  fallback_model = 'gemini-3.5-flash',
  temperature = 0::real,
  max_tokens = 8192,
  thinking_level = 'low',
  input_usd_per_mtok = 2::real,
  output_usd_per_mtok = 10::real,
  fallback_input_usd_per_mtok = 1.5::real,
  fallback_output_usd_per_mtok = 9::real,
  updated_at = now()
WHERE task = 'evaluate_job';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM model_routing
    WHERE task = 'evaluate_job'
      AND provider = 'anthropic' AND model = 'claude-sonnet-5-5'
      AND fallback_model = 'gemini-3.5-flash'
      AND temperature = 0::real AND max_tokens = 8192 AND thinking_level = 'low'
      AND input_usd_per_mtok = 2::real AND output_usd_per_mtok = 10::real
      AND fallback_input_usd_per_mtok = 1.5::real AND fallback_output_usd_per_mtok = 9::real
  ) THEN
    RAISE EXCEPTION 'evaluate_job: la fila no quedó como se esperaba';
  END IF;
END $$;

COMMIT;
```

**Archivo `alta-cv-interview-cv-write.sql`** (solo si la consulta 3.2 muestra que **faltan** las filas del CV; si ya están iguales al seed, no hace nada de más; si están y son distintas, la guarda final frena y revierte):

```sql
-- Filas cv_interview y cv_write (valores de packages/db/seeds/model_routing.json). Necesarias con CV_CHAT_ENABLED=all.
BEGIN;

DO $$
BEGIN
  IF (SELECT count(*) FROM model_routing WHERE task IN ('cv_interview', 'cv_write')) = 1 THEN
    RAISE EXCEPTION 'cv_interview/cv_write: está una sola de las dos filas; mirá el estado antes de seguir';
  END IF;
END $$;

INSERT INTO model_routing
  (task, provider, model, fallback_model, temperature, max_tokens, thinking_level,
   input_usd_per_mtok, output_usd_per_mtok, fallback_input_usd_per_mtok, fallback_output_usd_per_mtok)
VALUES
  ('cv_interview', 'google', 'gemini-3.5-flash', 'claude-haiku-4-5', 0::real, 1024, 'minimal',
   1.5::real, 9::real, 1::real, 5::real),
  ('cv_write', 'google', 'gemini-3.5-flash', 'claude-sonnet-5-5', 0.3::real, 3000, 'minimal',
   1.5::real, 9::real, 2::real, 10::real)
ON CONFLICT (task) DO NOTHING;

DO $$
BEGIN
  IF (
    SELECT count(*) FROM model_routing
    WHERE (task = 'cv_interview' AND provider = 'google' AND model = 'gemini-3.5-flash'
           AND fallback_model = 'claude-haiku-4-5' AND temperature = 0::real AND max_tokens = 1024
           AND thinking_level = 'minimal' AND input_usd_per_mtok = 1.5::real AND output_usd_per_mtok = 9::real
           AND fallback_input_usd_per_mtok = 1::real AND fallback_output_usd_per_mtok = 5::real)
       OR (task = 'cv_write' AND provider = 'google' AND model = 'gemini-3.5-flash'
           AND fallback_model = 'claude-sonnet-5-5' AND temperature = 0.3::real AND max_tokens = 3000
           AND thinking_level = 'minimal' AND input_usd_per_mtok = 1.5::real AND output_usd_per_mtok = 9::real
           AND fallback_input_usd_per_mtok = 2::real AND fallback_output_usd_per_mtok = 10::real)
  ) <> 2 THEN
    RAISE EXCEPTION 'cv_interview/cv_write: las filas no quedaron como el seed';
  END IF;
END $$;

COMMIT;
```

Para prender el chat de CV a todas las cuentas: además de las filas, `CV_CHAT_ENABLED=all` y `CV_CHAT_DAILY_CAP_USD` definida a propósito (`docs/beta/capacidad.md` sugiere **2** con `CV_CHAT_ENABLED=all`; el default de USD 1 por día lo agotan 3 o 4 charlas).

**Cómo verificar.**

1. Repetí la consulta de 3.2: `evaluate_job` con los valores que elegiste y `updated_at` reciente.
2. Después de 5 minutos, pegá un aviso de prueba (datos inventados) en la app o esperá el cron de evaluación.
3. `pnpm llm:spend --days 1`: la tarea `evaluate_job` tiene que aparecer con el modelo nuevo y un costo por llamada cercano al estimado.
4. Chat de CV: con una cuenta de prueba, `/cv/armar` responde (si falta la fila, falla con `no_route`).

**Cuánto tarda.** 15 minutos entre la consulta, el ensayo y la aplicación. Medir el costo real de B lleva unos días de tráfico.

---

## §4. PR #392: evaluar ofertas cada hora

**Qué es.** «[nube C8] Propuesta: evaluate cada hora» agrega `.github/workflows/cron-evaluate.yml`, un workflow aparte que corre **solo el paso `evaluate`** a los **:30 de cada hora** (el cron de 6 horas de `cron.yml` corre a los :00). Es borrador, base `main`, un solo archivo nuevo de 51 líneas.

**Cómo funciona** (diff del PR):

- **Apagado por defecto:** el job tiene `if: vars.EVALUATE_HOURLY == '1'`. Sin esa variable de repositorio, cada corrida se saltea sin llamar a nada.
- Mismo grupo de concurrencia (`cron`, sin cancelar) que `cron.yml`: nunca corren dos evaluaciones a la vez.
- Mismas comprobaciones de la respuesta que `cron.yml` (`ok:true`, falla si hay 0 evaluadas y errores).
- Para prenderlo: https://github.com/Malejo01/job-search-os/settings/variables/actions › **New repository variable** › `EVALUATE_HOURLY` = `1`. Para apagarlo, borrarla o ponerla en `0`.

**Cuánto cuesta por mes.**

- **Minutos de Actions: USD 0.** El repo es público (`docs/beta/costos-por-usuario.md` §1.3). Solo para dimensionar: 24 corridas por día × 30 = 720 corridas por mes; con cola vacía cada una dura segundos (facturación redondeada a 1 minuto = hasta 720 minutos, que serían una fracción de los 2.000 incluidos si el repo fuera privado).
- **Llamadas de LLM: no suben el gasto total.** Lo sigue frenando `LLM_DAILY_CAP_USD` en el worker. Lo que cambia es la capacidad: de 200 a hasta 1.400 evaluaciones posibles por día (24 × 50 + 4 × 50, según el PR); solo se usan si hay cola. Por eso el costo real depende de cuántas ofertas haya para evaluar, no de la frecuencia: con la cola vacía, USD 0. Con cola llena, sería lo mismo que hoy pero evaluado antes.
- **Efecto colateral (no es plata de LLM):** cada corrida llama a `https://<dominio>/api/cron/evaluate` en Vercel (hasta ≈ 2,5 min por invocación, según el PR) y consulta la cola en Neon: **720 invocaciones y despertares de la base por mes en vez de 120**. En Neon Free la base se suspende tras unos minutos sin uso; con consultas cada hora quedaría activa más horas por mes (A confirmar el impacto real en CU-hours en Neon › Monitoring; `docs/beta/costos-por-usuario.md` §4 ya marca ese límite como el riesgo operativo más alto del Free).

**Riesgos.**

- Gasto de LLM más concentrado en menos horas del día; el tope diario global (`LLM_DAILY_CAP_USD`, que el runbook sugiere en 4) lo corta.
- Más invocaciones y consultas a Neon (arriba).
- GitHub puede demorar los `schedule`; y los `schedule` corren solo desde `main`, por eso no se puede probar en el PR (lo dice el PR).
- Es carril rojo (`.github/**`): lo mergea Mauro. El check `carril` figura en rojo en el PR por eso, no por un error.

**Conflictos.** No debería tener: agrega un archivo nuevo que no existe en `main`. `gh pr view 392` mostró `mergeable: UNKNOWN` (GitHub todavía no lo calculó); los demás checks (`lint-typecheck`, `unit`, `integration`, `build`, `evals`, `e2e`, `secrets`) estaban en verde a la fecha del último commit (2026-11-03).

**Recomendación.** Mergearlo sin prenderlo: apagado por defecto no hace nada y deja la palanca lista. Prender `EVALUATE_HOURLY=1` **solo si** `/api/cron/status` (checks `queue_*`) o el ensayo del 20 al 24/11 muestran que la cola crece (el PR cita, para el peor caso de la beta, unos 145 por día de cola nueva con el cron de 6 h). Si preferís no sumar archivos de workflow antes del 26/11, mantenelo abierto: no hace falta para el 11/11.

**Cómo verificar (si lo mergeás y lo prendés).** Actions › workflow `cron-evaluate` › corrida a los :30: el paso «Evaluar cola» muestra el JSON; con la variable apagada, el job aparece como saltado.

**Cuánto tarda.** 5 minutos para decidir y mergear; 2 minutos para prender la variable.

---

## §5. Exportar 2 o 3 alertas de Computrabajo a `fixtures-private/`

**Qué es.** Para escribir el lector de las alertas de Computrabajo hacen falta emails reales (ADR-024 §9: sin lector validado, esos emails van a la cola manual del pool). Las alertas llegan a las casillas `pool-<carrera>@<INGEST_DOMAIN>` y se guardan en `inbound_emails` (sin usuario, `parser = 'pool_computrabajo_alerts'`) con el crudo en `raw_blobs`. Lo corrés vos; los agentes no leen `fixtures-private/`.

**Pasos.**

1. Listar las últimas alertas (solo lectura, contra Neon):

   ```bash
   pnpm db:sql "select e.id, e.received_at, e.from_address, e.subject, e.error, r.bytes from inbound_emails e join raw_blobs r on ('pg:' || r.id::text) = e.raw_ref where e.user_id is null and e.parser = 'pool_computrabajo_alerts' order by e.received_at desc limit 8"
   ```

   Elegí 2 o 3 de **carreras distintas** y, de ser posible, una de verificación (el primer email de doble opt-in) y una alerta con ofertas. Si la columna `error` dice «…sin el cuerpo», era un email que pasó el tope de 256 KB (solo se guardó remitente, asunto y fecha): no sirve.
2. Traer el cuerpo de cada una. Opción recomendada: abrí la consola de Neon › tu proyecto › **SQL Editor** (https://console.neon.tech, proyecto de la app) y corré, reemplazando `<id>`:

   ```sql
   select r.body from inbound_emails e join raw_blobs r on ('pg:' || r.id::text) = e.raw_ref where e.id = '<id>';
   ```

   Copiá el valor de la celda **entero** (no el truncado) y pegalo en un archivo nuevo dentro de `fixtures-private/` (por ejemplo `fixtures-private/alertas-computrabajo/alerta-1.json`; la carpeta está en `.gitignore`). El cuerpo guardado es un JSON (`event`, `content`, `pool_career`), no un `.eml`: el HTML del email va dentro de `content`. Repetí para cada id.
3. **No pegues el contenido en chats, issues ni PRs**: tiene tu dirección de alerta, tokens de baja y de tracking.

**Valores / tablas usados.** `inbound_emails` (`id`, `user_id`, `from_address`, `subject`, `raw_ref`, `parser`, `received_at`), `raw_blobs` (`id`, `body`, `bytes`); `raw_ref` tiene la forma `pg:<id>` (`packages/db/schema.ts`). A confirmar: no existe en el repo un script que exporte el cuerpo a un archivo, por eso el paso 2 es manual; si querés automatizarlo se abre un ticket.

**Cómo verificar.** Los archivos existen en `fixtures-private/`, abren como JSON (el HTML del email va dentro de `content`) y `git status` **no** los muestra (están ignorados).

**Cuánto tarda.** 10 minutos. Requisito: que ya hayan llegado alertas (§6).

---

## §6. Verificar que la cola del pool reciba alertas

**Qué es.** Comprobar que las alertas de Computrabajo suscriptas a las casillas del pool están llegando a la cola manual del pool (`docs/OPERACION.md`, «Casillas del pool por alertas de email»).

**Requisitos (se verifican antes en Vercel).** https://vercel.com/lizarraga-mauros-projects/job-search-os/settings/environment-variables: `POOL_SOURCE_COMPUTRABAJO_ALERTS` = `1` (cualquier otro valor es apagado) e `INGEST_DOMAIN` definido. Las alertas se suscriben en Computrabajo con la dirección `pool-<carrera>@<INGEST_DOMAIN>`, donde `<carrera>` es una clave de `ROLE_KEYS`; no hay que crear nada en Resend.

**Consulta (solo lectura, contra Neon):**

```bash
pnpm db:sql "select date_trunc('day', received_at) as dia, count(*) as emails, count(*) filter (where error like '%sin el cuerpo%') as sin_cuerpo, max(received_at) as ultimo from inbound_emails where user_id is null and parser = 'pool_computrabajo_alerts' group by 1 order by 1 desc limit 7"
```

**Qué número esperar.**

- **Mayor que 0 por día** en cuanto las alertas estén suscriptas y confirmadas (Computrabajo usa doble opt-in: el primer email es de verificación).
- Orden de magnitud (estimación mía, A confirmar con la realidad): ADR-024 §7 prevé «unas pocas alertas por carrera» sobre 6 carreras; con 2 o 3 alertas por carrera y un email diario por alerta, unos **12 a 18 emails por día**.
- **Topes del código:** máximo **30 por hora** y **200 por día** en esta cola (`POOL_QUEUE_MAX_PER_HOUR` y `POOL_QUEUE_MAX_PER_DAY`, `packages/adapters/src/inbound/pool-mailbox.ts`). Si te acercás a 200, hay una alerta que manda de más.
- `jobs_extracted` es 0 hasta que exista el lector (por diseño: «cola manual», nunca extracción parcial).

**Si da 0 filas.** En orden: (1) `POOL_SOURCE_COMPUTRABAJO_ALERTS` no es `1`; (2) `INGEST_DOMAIN` vacío; (3) el remitente real no está en `POOL_ALERT_SENDER_DOMAINS` (hoy solo `computrabajo.com` y sus subdominios; si el portal manda desde otra variante por país, hay que agregarla); (4) la clave de carrera de la casilla no existe; (5) el webhook de Resend no apunta al dominio actual (`docs/DEPLOY.md`, paso 8). Los rechazos no se guardan: el webhook responde como con un destinatario desconocido. Mirá también Resend › Webhooks › los envíos recientes.

**Cómo verificar que quedó bien.** La consulta muestra filas de hoy o de ayer, y `ultimo` es reciente.

**Cuánto tarda.** 5 minutos.

---

## §7. Casilla de contacto del producto reenviada al Gmail

**Qué es.** Hace falta una casilla de contacto atendida por Ani (la de `CONTACT_EMAIL`, runbook §1.2). No hace falta un buzón: alcanza con **reenviar** lo que llegue a esa casilla al Gmail de quien la atienda.

**Punto clave: no se toca la ingesta.** El correo de `ingest` entra por **otro dominio** (`ingest.malejo.com.ar`, `docs/DEPLOY.md`), con su propio MX y el webhook de Resend. `afiniajobs.com.ar` es otro dominio: en Resend solo está verificado para **envío** (registros en `send.afiniajobs.com.ar`, que son subdominio y **no** chocan con un MX en la raíz). Ponerle MX a la raíz de `afiniajobs.com.ar` no afecta la recepción de `u_<token>@ingest.malejo.com.ar`. Lo único que no hay que hacer es borrar ni modificar los registros de Resend (los `send.` y el `resend._domainkey`).

**Comparación de las dos opciones gratis.**

| | A. ImprovMX (reenvío) | B. Resend inbound |
| --- | --- | --- |
| Qué es | Servicio de reenvío; no guarda buzón | Resend recibe y manda un webhook a tu app (`email.received`) |
| Costo | Gratis: 1 dominio, 25 alias, **500 reenvíos por día** (https://improvmx.com/pricing) | Gratis dentro del plan de Resend; **A confirmar** si los entrantes cuentan en el cupo de 100 por día (`docs/beta/costos-por-usuario.md` §7, punto 3) |
| Registros en la raíz | 2 MX + 1 TXT (abajo) | 1 MX que da el panel de Resend (https://resend.com/docs/dashboard/receiving/custom-domains) |
| Reenvía al Gmail | **Sí, es lo que hace** | **No solo**: Resend entrega al webhook. Reenviar exige código nuevo o configurar el reenvío de Resend; **el webhook actual `/api/inbound` ignora los destinatarios que no son de ingesta** (responde `unknown_recipient` sin guardar nada), así que el mail se perdería |
| Riesgo con la ingesta | Ninguno (otro dominio) | Compartiría el mismo webhook y `RESEND_WEBHOOK_SECRET` con la ingesta: un cambio ahí podría tocar la recepción |
| Responder desde la casilla de contacto | No (envío SMTP es de pago); A confirmar alternativa: «Enviar como» en Gmail usando el SMTP de Resend | Resend envía, pero es código |
| Límite | Al llegar a 500 por día, **frena el reenvío** hasta el día siguiente | — |

**Recomendación: A, ImprovMX.** Es lo único que cumple «reenviada al Gmail» sin escribir código ni tocar la ingesta. B solo tiene sentido si más adelante querés procesar los mensajes en la app. **ForwardEmail** (https://forwardemail.net/en/faq) es la alternativa gratis a ImprovMX si este no te convence (MX `mx1.forwardemail.net` y `mx2.forwardemail.net` prioridad 0 en la raíz, más un TXT `forward-email=<alias>:<tu email>`; su guía advierte que en plan no pago las reglas de reenvío son «públicamente buscables» en el DNS, o sea que el Gmail de destino quedaría visible: por eso no la recomiendo).

**Pasos (opción A).**

1. Creá la cuenta en https://improvmx.com y agregá el dominio `afiniajobs.com.ar`.
2. Creá el alias de la casilla de contacto (lo que va antes de la @ en `CONTACT_EMAIL`) que reenvía a `<tu email>` (o al del Gmail que use Ani).
3. En Vercel abrí https://vercel.com/dashboard/domains › `afiniajobs.com.ar` › **DNS Records**. Primero mirá si ya hay un MX o un TXT de SPF en la raíz (`@`). ImprovMX pide **borrar los MX existentes** de la raíz; no borres nada de `send.` ni `resend._domainkey`.
4. Agregá estos registros (valores de https://improvmx.com/guides/generic-dns-configuration/, consultada el 2026-11-06):

   | Tipo | Nombre / Host | Valor | Prioridad |
   | --- | --- | --- | --- |
   | MX | `@` (raíz) | `mx1.improvmx.com` | 10 |
   | MX | `@` (raíz) | `mx2.improvmx.com` | 20 |
   | TXT | `@` (raíz) | `v=spf1 include:spf.improvmx.com ~all` | (sin prioridad) |

   Si la raíz ya tiene un TXT que empieza con `v=spf1`, **no agregues un segundo**: fusioná el `include:spf.improvmx.com` dentro del existente (solo puede haber un SPF por dominio). A confirmar qué hay hoy en la raíz de `afiniajobs.com.ar`.
5. En ImprovMX, **Check DNS** hasta que figure verde (hasta 24 a 48 horas, casi siempre minutos).
6. Cargá `CONTACT_EMAIL` (el valor está en el runbook §1.2) en Vercel si no estaba (runbook §1.2) y redeploy.

**Cómo probarla sin romper la ingesta.**

1. Desde **otra cuenta de correo** (no el mismo Gmail de destino: los mensajes a uno mismo pueden no aparecer, según la guía de ForwardEmail y vale igual para esto), escribile a la casilla de contacto. Tiene que llegar al Gmail en minutos; mirá también spam.
2. Panel de ImprovMX › log de emails (se conserva 7 días en el plan gratis).
3. Comprobá que la ingesta sigue igual: reenviá una alerta de prueba a tu dirección `u_<token>@ingest.malejo.com.ar` y mirá que aparezca en la bandeja de la app, o mirá en Resend › Webhooks que `email.received` siga respondiendo 200. No debería cambiar nada: son dominios distintos.
4. Resend › Domains › `afiniajobs.com.ar`: sigue **Verified** (los registros de envío no se tocaron).

**Cuánto tarda.** 20 minutos más la propagación del DNS.

---

## §8. Fuentes The Muse y ReliefWeb

**Qué es.** Dos fuentes de ofertas para las carreras no tech. Con el dominio y la casilla nuevos podés hacer los trámites con una identidad del producto. **Importante: pedir la key o el appname no activa nada por sí solo.** Estado del código hoy:

- **ReliefWeb:** el adapter `packages/adapters/src/sources/reliefweb.ts` existe en `main`, apagado: sin `RELIEFWEB_APPNAME` no hace ninguna llamada de red. No está enchufado al cron del pool (no hay valor `reliefweb` en `source_kind` ni en `POOL_SOURCES`; `docs/adr/028-fuente-reliefweb.md` propone la migración para cuando se decida).
- **The Muse:** solo hay ADR-030 (`Proposed`) y la ficha `docs/sources/themuse.md`; **no hay adapter**. El ADR dice que para la apertura del 26/11 se recomienda apostar a otros caminos (ATS de LATAM y las alertas de Computrabajo) y dejar The Muse «para después de medir».

**Qué se destraba.**

- ReliefWeb: la solicitud del `appname` pide describir organización y propósito, y la respuesta llega por email; con la casilla de contacto ya podés pedirlo con una dirección del producto y que te respondan ahí (A confirmar si exigen un dominio propio: la página no lo dice).
- The Muse: una key gratis sube el límite de 500 a **3.600 pedidos por hora**. También se puede usar sin key (500 por hora).

**Pasos ReliefWeb (`docs/adr/028*`, `docs/sources/reliefweb.md` §3).**

1. Abrí https://apidoc.reliefweb.int/ y completá el formulario de solicitud de appname que enlaza esa página (https://docs.google.com/forms/d/e/1FAIpQLScR5EE_SBhweLLg_2xMCnXNbT6md4zxqIB00OL0yZWyrqX_Nw/viewform).
2. Nombre sugerido por su página: nombre de la organización + propósito + caracteres al azar. El ADR usa de ejemplo `job-search-os-afinia`; **A confirmar el nombre final**, y usá la casilla de contacto del producto como email.
3. Esperá la respuesta por email (ReliefWeb revisa cada pedido).
4. Con el appname aprobado, cargá en Vercel `RELIEFWEB_APPNAME` = el appname (variable de entorno, no es un secreto de cuenta pero tratalo como interno).
5. Antes de integrarlo al cron, medí volumen real con `pnpm pool:fetch` (lo recomienda el ADR) y la ficha: cuántos avisos remotos o *home-based* hay por semana.

**Pasos The Muse (`docs/adr/030*`, `docs/sources/themuse.md` §3).**

1. Entrá a https://www.themuse.com/developers/api/v2 y a «Manage your apps» (`/developers/api/v2/apps`) para registrar la app y obtener la key (su página dice que el registro es «required for any use beyond testing»). Los campos exactos del formulario no figuran en la página: A confirmar al llegar.
2. Cuando el adapter exista, la key va en `THEMUSE_API_KEY` (opcional, según ADR-030). **Hoy esa variable no la lee ningún código**: no cargues nada todavía.
3. Antes de integrar: corrida exploratoria con `location=Flexible / Remote` para ver qué porcentaje admite contratistas de LATAM (la mayoría de los avisos son de EE. UU.).

**Cómo verificar.** ReliefWeb: tenés el email de aprobación guardado; con el appname cargado, una corrida de prueba de `fetchReliefWebJobs` devuelve avisos (si no, devuelve `disabled: true`). The Muse: la key aparece en «Manage your apps».

**Cuánto tarda.** 10 minutos cada trámite; la respuesta de ReliefWeb depende de ellos (A confirmar).

---

## §9. Costos: lo que falta confirmar

**Qué es.** Los 11 puntos que `docs/beta/costos-por-usuario.md` §7 deja «a confirmar», con dónde mirás cada dato. Marcalos cuando los tengas y pasá los números a «Costos y stack» en Notion.

| # | Qué confirmar | Dónde lo mirás |
| --- | --- | --- |
| 1 | Tokens reales por evaluación con `evaluate_job@v1.3.4` y avisos reales (el doc supone avisos de 4 KB) | `pnpm llm:spend --days 7` o `https://<dominio>/settings/metricas` (por tarea y modelo), cuando haya tráfico |
| 2 | Si la comisión de Mercado Pago (6,29 %) suma IVA, y desde qué fecha rige la tarifa | Hacer un cobro real y mirar el detalle en Mercado Pago › Actividad; tarifa en https://www.mercadopago.com.ar/herramientas-para-vender/link-de-pago |
| 3 | Si los emails **recibidos** cuentan en el cupo de 100 por día del plan gratis de Resend | Resend › Emails y Usage (https://resend.com/overview); o consultarlo a soporte de Resend |
| 4 | Plan actual de Vercel (¿Hobby o Pro?) y de Neon (¿Free o Launch?), y el consumo de CU-hours de Neon | Vercel: Settings › Billing del equipo y **Usage**; Neon: consola › **Monitoring** (Compute hours, Network transfer, Storage) y **Billing** |
| 5 | Si `ANTHROPIC_API_KEY` está cargada en producción; y si `cv_interview` y `cv_write` existen en `model_routing` de Neon | Vercel › Settings › Environment Variables (solo si existe la variable); la consulta de §3.2 |
| 6 | Valores reales en Vercel de `PRICING_ENABLED`, `LLM_DAILY_CAP_USD`, `LLM_USER_DAILY_CAP_USD`, `CV_CHAT_ENABLED` y `CV_CHAT_DAILY_CAP_USD` | Vercel › Settings › Environment Variables (el runbook sugiere `LLM_DAILY_CAP_USD` = 4; `docs/beta/capacidad.md` sugiere `CV_CHAT_DAILY_CAP_USD` = 2) |
| 7 | Costo real de un turno y una redacción de CV, y de un borrador de formulario (hoy son estimaciones sin red) | `pnpm llm:spend --days 7` después de unas charlas de prueba; ver `docs/LLM_COSTOS.md`, «Armá tu CV con IA» |
| 8 | Tarifa vigente del dominio `.com.ar` (la única que encontró el doc es de enero de 2024) | NIC.ar, tu cuenta (https://nic.ar) o el comprobante de la renovación |
| 9 | Con qué tipo de cambio pagás los servicios en dólares (oficial, tarjeta, otro) | El resumen de tu tarjeta o el comprobante de Vercel/Neon/Resend |
| 10 | Que la clave de Gemini tenga facturación activa | Google AI Studio / consola de Google Cloud › Facturación del proyecto de esta app (`docs/legal/datos-por-proveedor.md` ya lo marca) |
| 11 | Impuestos propios (monotributo, ingresos brutos), cuentas de admin y de prueba, horas de trabajo | Con tu contador/a; no están en las cuentas del doc |

**Cuánto tarda.** 1 hora en total si lo hacés de corrido; los puntos 1 y 7 necesitan tráfico real primero.

---

## §10. PRs viejos abiertos (#347, #308, #69)

**Qué es.** Tres borradores viejos. Miré cada uno con `gh pr view` el 2026-11-06. **No los cerré ni les comenté.** Las recomendaciones son mías; decidís vos.

| PR | Qué es | Estado | ¿Vigente? | Recomendación |
| --- | --- | --- | --- | --- |
| **#347** | «[nube C6] NO MERGEAR hasta aprobar la marca · nombre AfinIAJobs». Cambia `BRAND.name` a «AfinIAJobs» y un test del User-Agent. Base `nube/c6-marca`, 2 archivos | Borrador, `MERGEABLE`, `CLEAN`; última actualización 2026-11-01 | **No.** `main` ya tiene el nombre: `packages/pipeline/src/brand.ts` define `BRAND.name` como «AfinIAJobs» (logotipo `AfinIA` + `Jobs`, decisión del 2/11). Además su base es otra rama, no `main` | **Cerrar** |
| **#308** | «[gemini G2] ADR-028 y adapter de ReliefWeb (G2-4)». Apilado sobre `nube/c1-backlog` | Borrador, `MERGEABLE`, `CLEAN`; creado 2026-10-31 | **Ya está en `main`.** Existen `docs/adr/028-fuente-reliefweb.md`, `docs/sources/reliefweb.md`, `reliefweb.ts`, su test y la fixture `reliefweb-sample.json`. Su base (`nube/c1-backlog`) es una rama vieja | **Cerrar**. Falta, cuando decidas, la migración del enum y el cableado al cron (ADR-028, punto 5): es un ticket nuevo, no este PR |
| **#69** | «feat(inbound): parser de emails de Eightfold y reproceso de la cola manual (falta validar con .eml real)». Base `main`, 16 archivos, parser + `reprocess-cli.ts` | Borrador, `mergeStateStatus` y `mergeable` **UNKNOWN**; última actualización 2026-10-30; creado 2026-10-12 | **Sí, pero no está en `main`**: no existen `inbound/eightfold.ts` ni `reprocess.ts`. El propio PR dice «no mergear hasta probarlo con un email real» | **Mantener** si todavía querés ese parser; hoy no es prioridad para las 6 carreras no tech. Alternativa: **cerrar** y reabrir con un `.eml` real cuando haya uno. Si lo mantenés: falta un `.eml` real de Eightfold, validar la estructura, y probablemente rebasar/actualizar contra `main` (ya tiene 3 semanas de cambios; GitHub todavía no calculó si hay conflictos) |

**Cómo verificar lo que dije.** `gh pr view 347 --json state,mergeStateStatus,baseRefName`; `gh pr view 308 --json state,files`; `gh pr view 69 --json state,files`. En el repo: buscá `reliefweb.ts` y `eightfold.ts` en `packages/adapters/src/`.

**Cuánto tarda.** 5 minutos por PR para cerrar (con un comentario corto de por qué).

---

## §11. Links de pago con descuento en Mercado Pago

**Pendiente: se completa si R4-11 se destraba.**

---

## §12. Prender el agente conversacional para Mauro y Ani (R4-15)

**Qué es.** El asistente ya existe en el código, apagado y solo para admins. R4-15 (todavía **no implementado**) agrega una lista aparte de «personas de prueba» para que Ani lo use sin ser admin, la mascota abajo a la derecha y el chip «¿Algo no anduvo?» en otro lugar. Fuentes: Notion (R4-15 y «Agente conversacional: plan y lista de pruebas») y el código actual.

**Lo que ya se sabe del código actual** (`packages/pipeline/src/agent/gate.ts`, `apps/web/lib/assistant.ts`, `apps/web/app/api/assistant/route.ts`):

- `ASSISTANT_ENABLED` hoy solo vale `admin`. **Cualquier otro valor (vacío, `1`, `all`, `Admin`) cuenta como apagado.**
- Para usarlo hace falta, además, que el email de la sesión esté en `ADMIN_EMAILS`. Sin sesión o fuera de la lista, la ruta responde **404** `no_encontrado`.
- Esa lista da permisos de admin: **no agregues a Ani a `ADMIN_EMAILS`** (el runbook y la auditoría del 1/11 piden un solo email ahí).

**Lo que depende de R4-15** (no inventar): **A confirmar cuando R4-15 esté en main: el nombre de la variable nueva con los emails de prueba y el valor nuevo de `ASSISTANT_ENABLED`** (la página de Notion solo dice «variable nueva con los emails de prueba, sin dar permisos de admin»; el código actual no las tiene). Dejo el espacio para completarlo:

| Variable | Valor | Fuente |
| --- | --- | --- |
| `ASSISTANT_ENABLED` | A confirmar cuando R4-15 esté en main: el valor nuevo (hoy `admin`) | gate de R4-15 |
| A confirmar cuando R4-15 esté en main: nombre de la lista de personas de prueba | `<tu email>,<email de Ani>` (separados por coma, sin espacios; los completás vos) | gate de R4-15 |

**Orden recomendado (el PR de R4-15 es carril rojo y lo mergeás vos).**

1. **Antes de todo:** aplicá la fila `assistant_chat` (§13). Sin ella el asistente responde `no_route` aunque la cuenta esté habilitada.
2. Mergeá el PR de R4-15 y esperá el deploy en verde.
3. Cargá en Vercel (https://vercel.com/lizarraga-mauros-projects/job-search-os/settings/environment-variables) las variables que diga R4-15, en Production.
4. Redeploy (Deployments › ⋯ › **Redeploy**).
5. Probá (abajo).

Por qué en este orden: con el código actual, cualquier valor de `ASSISTANT_ENABLED` distinto de `admin` apaga el asistente, así que cargar el valor nuevo antes del merge lo apagaría también para vos. Merge primero y variables después evita ese hueco. A confirmar cuando R4-15 esté en main: si el PR cambia este orden.

**Cómo verificar.**

1. Con tu cuenta: ves la mascota y podés chatear (lista de pruebas de Notion, punto A).
2. Con la cuenta de Ani: la ve y chatea, y **no ve nada de admin** (`/settings/planes`, `/settings/metricas` dan 404).
3. Con una **cuenta común de prueba** (no admin y fuera de la lista): **no aparece la mascota** y, llamando directo, la ruta responde 404. Con la sesión de esa cuenta: `curl -i -X POST https://<dominio>/api/assistant -H "content-type: application/json" -H "cookie: <la cookie de sesión de esa cuenta>" -d '{}'` (hoy devuelve `404`; A confirmar cuando R4-15 esté en main si cambia el código).
4. Sin sesión: la mascota no aparece en ninguna página.

**Cuánto tarda.** 15 minutos más lo que tarde el deploy. La decisión de publicarlo a la beta es el 20/11 (plan en Notion).

---

## §13. Fila `assistant_chat` en `model_routing` (R4-17)

**Qué es.** El asistente (`streamAgent`) lee su modelo de `model_routing`, tarea `assistant_chat` (`packages/adapters/src/llm/agent.ts`, `ASSISTANT_TASK`). **Sin fila falla cerrado (`no_route`).** Hoy `packages/db/seeds/model_routing.json` **no tiene** esa fila, así que no puedo sacar los valores del seed (la regla es no inventarlos). R4-17 (todavía **no implementado**) agrega los prompts con la ficha de Ani y el SQL de la fila.

**A confirmar cuando R4-17 esté en main: el modelo, el respaldo, la temperatura y las tarifas definitivas, y que el seed tenga la fila.** Si el seed la trae, copiá los valores de ahí y reemplazá los de abajo.

**Lo que ya se puede saber del código:**

- Prompt: `assistant_chat@v1` (`apps/web/app/api/assistant/route.ts`).
- Tope de salida por paso: `min(max_tokens de la fila, 600)` (`AGENT_LIMITS.maxOutputTokensPerStep = 600`). Por eso `max_tokens` por encima de 600 no sirve.
- **Con thinking hace falta `max_tokens` ≥ 8192** (ADR-025), y acá el tope efectivo es 600: entonces `thinking_level` tiene que quedar **vacío (`NULL`)** si el principal es Sonnet.
- Tarifas de cada modelo: solo las del seed (Sonnet 5.5: 2 / 10; Gemini 3.5 Flash: 1,5 / 9). Un test del repo exige que la tarifa de un modelo sea la misma en todas las filas.
- Topes por conversación: 10 turnos, 6 pasos por turno y USD 0,12 (`packages/pipeline/src/agent/limits.ts`).
- Nombres de modelos: solo los de `seeds/model_routing.json`.

**SQL provisorio** (para revisar con R4-17; archivo `alta-assistant-chat.sql`). Es una **propuesta mía con los modelos del seed**, no el valor decidido: principal Sonnet 5.5 (como las demás tareas de charla: `skill_interview`, `recruiter_message`), respaldo Gemini 3.5 Flash, temperatura 0,3 (la de `skill_interview`). Si hoy ya hay una fila `assistant_chat`, la guarda frena el ensayo.

```sql
-- assistant_chat: PROVISORIO hasta que R4-17 confirme los valores. Modelos y tarifas solo del seed.
-- thinking_level NULL: el tope de salida del asistente es 600 por paso (menos de los 8192 que pide el thinking).
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM model_routing WHERE task = 'assistant_chat') THEN
    RAISE EXCEPTION 'assistant_chat: ya existe una fila; mirala antes de pisarla';
  END IF;
END $$;

INSERT INTO model_routing
  (task, provider, model, fallback_model, temperature, max_tokens, thinking_level,
   input_usd_per_mtok, output_usd_per_mtok, fallback_input_usd_per_mtok, fallback_output_usd_per_mtok)
VALUES
  ('assistant_chat', 'anthropic', 'claude-sonnet-5-5', 'gemini-3.5-flash', 0.3::real, 600, NULL,
   2::real, 10::real, 1.5::real, 9::real);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM model_routing
    WHERE task = 'assistant_chat'
      AND provider = 'anthropic' AND model = 'claude-sonnet-5-5'
      AND fallback_model = 'gemini-3.5-flash'
      AND temperature = 0.3::real AND max_tokens = 600 AND thinking_level IS NULL
      AND input_usd_per_mtok = 2::real AND output_usd_per_mtok = 10::real
      AND fallback_input_usd_per_mtok = 1.5::real AND fallback_output_usd_per_mtok = 9::real
  ) THEN
    RAISE EXCEPTION 'assistant_chat: la fila no quedó como se esperaba';
  END IF;
END $$;

COMMIT;
```

**Pasos.**

1. Antes, mirá si hay fila (solo lectura): `pnpm db:sql "select * from model_routing where task = 'assistant_chat'"`. Esperado: 0 filas.
2. Guardá el SQL en Descargas como `alta-assistant-chat.sql` (o el que traiga R4-17, cuando esté en main).
3. **Ensayo primero** (contra Neon, termina en `ROLLBACK`):

   ```bash
   pnpm --filter @job-search-os/db exec tsx src/run-sql-file.ts --file "C:/Users/<usuario>/Downloads/alta-assistant-chat.sql" --ensayo
   ```

   Tiene que terminar con «OK: el ensayo corrió entero y la guarda pasó».
4. Aplicar (pide escribir `si`):

   ```bash
   pnpm --filter @job-search-os/db exec tsx src/run-sql-file.ts --file "C:/Users/<usuario>/Downloads/alta-assistant-chat.sql"
   ```

5. Esperá hasta 5 minutos (caché de rutas).

**Cómo verificar.** La consulta del paso 1 devuelve la fila. Con el asistente prendido (§12), una charla de prueba responde (no `no_route`) y en `pnpm llm:spend --days 1` aparece la tarea `assistant_chat` con costo por debajo de USD 0,12 por conversación.

**Cuánto tarda.** 10 minutos.
