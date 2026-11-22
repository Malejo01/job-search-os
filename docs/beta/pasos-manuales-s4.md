# Pasos manuales de la tanda S4

Lo que tiene que hacer una persona (no un agente) para que lo de esta tanda llegue a producción. Todo lo de abajo que gasta, gasta poco y lo corre quien administra el proyecto; los agentes no corrieron ningún modelo real.

## §1. Claude como principal y Gemini de respaldo (ruteo de modelos)

**Qué es.** Decisión del 20/11 (opción B): las tareas que hoy usan Gemini como principal pasan a Claude, y Gemini queda de respaldo. `evaluate_job` ya usa Claude Sonnet 5.5 en producción: solo cambia su respaldo. La tabla `model_routing` decide el modelo de cada tarea; cambiarla es un `UPDATE` y no necesita deploy (la app cachea cada ruta 5 minutos). **Nunca se corre `pnpm db:seed` contra producción**: reescribe perfil y golden.

### 1.1 Qué cambia

| Tarea | Principal hoy | Principal nuevo | Respaldo nuevo |
| --- | --- | --- | --- |
| `evaluate_job` | claude-sonnet-5-5 (ya en producción) | igual | gemini-3.5-flash |
| `cv_write`, `cv_review`, `cv_coach_turn`, `extract_job_from_image` | gemini-3.5-flash | claude-sonnet-5-5 (2 / 10 USD por Mtok) | gemini-3.5-flash (1,5 / 9) |
| `extract_cv_profile`, `extract_skills`, `cv_interview` | gemini-3.5-flash | claude-haiku-4-5 (1 / 5) | gemini-3.5-flash |
| `parse_email_fallback` | gemini-3.1-flash-lite | claude-haiku-4-5 | gemini-3.1-flash-lite (0,25 / 1,5) |

`temperature` y `max_tokens` de cada tarea no cambian. `thinking_level` va `null` en las filas con principal Claude (solo aplica a Google); cuando Gemini entra de respaldo el cliente le manda razonamiento `minimal` (`packages/adapters/src/llm/model-capabilities.ts`). Los precios son solo los que ya estaban en el seed.

El cliente ya no manda `temperature` a los modelos que no la aceptan (Claude Sonnet 5.5) ni a modelos que no conoce: la tabla de capacidades falla cerrado. Una imagen solo viaja a un modelo que la lee.

### 1.2 Antes de nada

1. `ANTHROPIC_API_KEY` tiene que estar en Vercel (es ahora el proveedor principal de todo). `GEMINI_API_KEY` sigue haciendo falta: es el respaldo.
2. En el entorno `evals` de GitHub (Settings › Environments › evals) tiene que estar `ANTHROPIC_API_KEY`. Sin ella el job `evals` se saltea con aviso. `GEMINI_API_KEY` ahí es opcional.
3. Mirar el estado real de la tabla y **guardar la salida** (sirve para revertir):

   ```bash
   pnpm db:sql "select task, provider, model, fallback_model, temperature, max_tokens, thinking_level, input_usd_per_mtok, output_usd_per_mtok, fallback_input_usd_per_mtok, fallback_output_usd_per_mtok from model_routing order by task"
   ```

   Esperado: las 8 tareas de arriba (salvo `evaluate_job`) con `provider = google`. Si alguna difiere, el ensayo del SQL frena y lo dice.
4. `evaluate_job` en producción puede tener `thinking_level` y `max_tokens` distintos de los del seed (el seed dice `null` y 2048). El SQL **no los toca**; si querés alinearlos es un `UPDATE` aparte y consciente.

### 1.3 Mediciones antes de aplicar (las corre quien administra el proyecto; tope total USD 5)

Criterio para aprobar: **no empeorar las métricas de hoy en el golden** (y en las fixtures del coach de CV). Si empeoran, no se aplica el SQL de esa tarea: se deja Gemini de principal y se anota.

| Qué | Cubre | Comando exacto | `--max-usd` | Estimado |
| --- | --- | --- | --- | --- |
| Evaluador sobre el golden (ancla de 20 avisos) | `evaluate_job` | `pnpm evals run --prompt vigente --subset --runs 1 --concurrency 1 --db none --max-usd 0.60 --max-minutes 20` | 0,60 | USD 0,24 (20 llamadas × USD 0,012: entrada 3.895 y salida 430 tokens, `costos-por-usuario.md` §3.1, con la tarifa de Sonnet) |
| Coach de CV, charla completa, 4 fixtures públicas | `cv_coach_turn`, `cv_review`, `cv_write` | desde `evals/`: `pnpm exec tsx src/cv-coach/cli.ts --modo modelo --etapa charla --ids <4 ids> --runs 1 --max-usd 0.80 --db local` | 0,80 | USD 0,55 (4 CV × USD 0,14; el README de evals da USD 0,11 por CV con tarifas anteriores, +30 % por Sonnet) |

El coach acepta `--dry-run` (muestra el plan y el estimado y sale sin llamar a nada: corrélo antes). El evaluador imprime el plan y el estimado al arrancar y aborta antes de la primera llamada si el estimado pasa `--max-usd`. Los ids de las fixtures del coach son los nombres de `evals/fixtures/cv-coach/*.json`; elegí 4 distintas (por ejemplo una sin experiencia, una con experiencia, un cambio de carrera y una de otra disciplina). Con `--db local` hace falta Docker abierto. Comparación con hoy: `pnpm evals compare <reporte de hoy> <reporte nuevo>` para el evaluador, y el reporte de `evals/reports/cv-coach/` para el coach.

**Tareas sin harness de evals** (verificación corta con la app local y datos inventados, `node .claude/bin/local.mjs dev`, con la clave de Anthropic en el entorno local): `cv_interview` (un turno de «Armá tu CV con IA»), `extract_cv_profile` (subir un CV de fixture pública, del agente de perfil), `extract_job_from_image` (una captura de un aviso inventado, nunca uno real), `extract_skills` (`pnpm skills:extract` con un aviso inventado) y `parse_email_fallback` (no tiene llamada productiva: no se verifica). Cada una cuesta menos de USD 0,02 (por ejemplo un turno de entrevista, `(1.200 × 1 + 60 × 5) / 1e6 = USD 0,0015`; una lectura de imagen ≈ USD 0,01 [S: 1.500 tokens de entrada y 700 de salida con Sonnet]); total de este bloque ≤ USD 0,10. Se mira que devuelvan JSON válido y que `llm_calls` registre el modelo Claude (`pnpm llm:spend`).

**Total de la sección:** estimado USD 0,9; topes sumados USD 1,5 más USD 0,10 del bloque manual. Muy debajo del tope de USD 5.

**Riesgo conocido.** Un test anterior del seed decía que los modelos de Anthropic fallaban con `no_object` en las tareas del CV. Desde entonces el cliente manda salida estructurada nativa a Anthropic (`output_config`), pero **esta corrida es la que lo comprueba**: si alguna tarea del CV vuelve a fallar con Claude, esa tarea se deja en Gemini y se anota.

### 1.4 SQL de producción

Archivo versionado: `packages/db/sql/ruteo-s4.sql`. Hace un `UPDATE model_routing … WHERE task = …` por tarea dentro de `BEGIN; … COMMIT;`, con una guarda que frena todo si una fila no está como se espera **antes** del cambio (proveedor y modelo de hoy, y que existan las 9 filas) y otra **después** (que cada fila haya quedado exactamente como el seed, y que `temperature` y `max_tokens` no hayan cambiado). Está probado contra un Postgres de prueba (`packages/db/src/ruteo-sql.integration.test.ts`): el ensayo no deja nada, la corrida real deja el seed y las guardas frenan sin tocar nada.

Pasos (hacelo **después** de que las mediciones de §1.3 aprobaron):

1. **Ensayo primero** (contra Neon, termina en `ROLLBACK`):

   ```bash
   pnpm --filter @job-search-os/db exec tsx src/run-sql-file.ts --file sql/ruteo-s4.sql --ensayo
   ```

   Tiene que terminar con «OK: el ensayo corrió entero y la guarda pasó». Si una guarda frena, el mensaje dice qué tarea es: mirala antes de seguir.
2. Aplicar (pide escribir `si`):

   ```bash
   pnpm --filter @job-search-os/db exec tsx src/run-sql-file.ts --file sql/ruteo-s4.sql
   ```

3. Esperá hasta 5 minutos (caché de rutas) y repetí el `select` de §1.2: tiene que coincidir con la tabla de §1.1.
4. En los primeros días mirá `pnpm llm:spend --days 1`: modelo por tarea, errores y costo. Si una tarea falla seguido con Claude, se revierte esa fila con un `UPDATE` puntual usando los valores que guardaste en §1.2.

### 1.5 Prompts que dependan de algo propio de Gemini

Revisé `packages/prompts/**` buscando instrucciones o formatos propios de un proveedor: no hay ninguno (no nombran modelos ni piden formatos específicos de Gemini). Lo que sí es propio de cada proveedor y queda para la próxima tanda del evaluador: (a) el razonamiento `thinking_level` solo se mide con Gemini y con Sonnet 5.5 en `low`; con `null` en Claude manda el valor por defecto de la API; (b) los prompts de CV se afinaron contra Gemini: si el coach de CV pierde calidad con Sonnet, es terreno del evaluador (`packages/prompts/**` no se tocó en esta tanda).

### 1.6 Textos legales

La política de privacidad y `docs/legal/datos-por-proveedor.md` describen a Google como primer destino de la imagen y de las tareas de CV. Con este cambio el primer destino pasa a ser Anthropic y Google queda de respaldo. Revisá los textos (`apps/web/content/legal/**` es carril rojo y no se tocó).

### 1.7 Reservas de gasto del coach de CV

Con Sonnet de principal el máximo de un paso (principal más respaldo) subió, así que las reservas pasaron a `write` 0,08, `turn` 0,045 y `review` 0,07 (`packages/pipeline/src/cv-coach/limits.ts` y `cv-chat/limits.ts`). El tope de una charla (USD 0,30) sigue alcanzando para un turno más la redacción reservados. Efecto: con filas de costo desconocido, una charla corta por tope tras 4 turnos en vez de 5.
