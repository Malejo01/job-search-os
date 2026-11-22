# Pasos manuales de la tanda R17

## R17-02 · Prompt del asistente v1.1

- El prompt nuevo es `packages/prompts/assistant_chat.v1.1.md` y la ruta `api/assistant` lo usa al desplegar.
- `model_routing` se resuelve por tarea (`assistant_chat`), no por versión del prompt: **la fila existente sirve y no hace falta SQL ni cambio en el seed**.
- Lo único que se ve en producción es la fecha: el asistente dice «la beta abre a principios de diciembre» (y, si la fecha de hoy ya la pasó, que la beta ya abrió).
- Para volver atrás: apuntar `PROMPT_REF` de `apps/web/app/api/assistant/route.ts` otra vez a `assistant_chat@v1`.

## R17-08 · Simulador de entrevistas (`/interview`)

Hay tres pasos, **en este orden** y antes de abrir la pantalla a alguien: la migración, el SQL de `model_routing` y, cuando quieras medir la calidad, los evals. Sin la migración la pantalla da error al guardar; sin las filas de `model_routing` las dos tareas fallan cerradas (`no_route`) y la persona ve «Ahora no pudimos armar las preguntas». Ninguna de las dos cosas deja nada a medias.

### 1. Migración (Neon, la aplicás vos)

- Crea `interview_sessions` e `interview_answers` (con `user_id`, borrado en cascada con la cuenta) y sus policies: `packages/db/rls/0045_interview_sessions.sql` y `0046_interview_answers.sql`. Las policies llevan su propio `GRANT` a `authenticated`, porque `0030` retira los permisos de toda tabla que todavía no tiene RLS y corre antes.
- El archivo de Drizzle es `drizzle/0075_interview.sql` (renumerado al integrar con la S4, después de la 0073 y la 0074). Es solo `CREATE TABLE`, `CREATE INDEX` y claves foráneas: no toca ninguna tabla existente y no tiene datos que migrar.
- Antes de correrla, revisá el SQL generado (tiene que tener solo esas dos tablas) y corré `pnpm db:migrate` contra Neon; pide escribir `si`.
- Para volver atrás (si no hay filas todavía): `DROP TABLE interview_answers; DROP TABLE interview_sessions;`.

### 2. Filas de `model_routing` (Neon, las aplicás vos)

`interview_questions` va en Haiku 4.5 (más barato: solo arma 5 preguntas) y `interview_feedback` en Sonnet 5.5 (juzga la respuesta); las dos con respaldo Gemini 3.5 Flash y sin razonamiento extendido. Las tarifas son las del seed (Haiku 1 / 5, Sonnet 2 / 10, Gemini 1,5 / 9): un test del repo exige que la tarifa de un modelo sea la misma en todas las filas. Son las mismas filas que ya están en `packages/db/seeds/model_routing.json`; **no corras `db:seed`**.

1. Mirá primero si ya hay filas (solo lectura): `pnpm db:sql "select task, model from model_routing where task like 'interview_%'"`. Esperado: 0 filas.
2. Guardá este SQL en Descargas como `alta-interview-routing.sql`. Las reglas del archivo (empieza en `BEGIN;`, termina en `COMMIT;`) son las de `packages/db/src/run-sql-file.ts`. Si ya hay una fila de alguna de las dos tareas, la guarda frena el ensayo.

```sql
-- interview_questions e interview_feedback: mismos valores que las filas del seed. Modelos y tarifas solo del seed.
-- thinking_level NULL: son salidas cortas en JSON, sin razonamiento extendido.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM model_routing WHERE task IN ('interview_questions', 'interview_feedback')) THEN
    RAISE EXCEPTION 'interview: ya existe una fila de esas tareas; mirala antes de pisarla';
  END IF;
END $$;

INSERT INTO model_routing
  (task, provider, model, fallback_model, temperature, max_tokens, thinking_level,
   input_usd_per_mtok, output_usd_per_mtok, fallback_input_usd_per_mtok, fallback_output_usd_per_mtok)
VALUES
  ('interview_questions', 'anthropic', 'claude-haiku-4-5', 'gemini-3.5-flash', 0.5::real, 800, NULL,
   1::real, 5::real, 1.5::real, 9::real),
  ('interview_feedback', 'anthropic', 'claude-sonnet-5-5', 'gemini-3.5-flash', 0.3::real, 900, NULL,
   2::real, 10::real, 1.5::real, 9::real);

DO $$
BEGIN
  IF (SELECT count(*) FROM model_routing WHERE task IN ('interview_questions', 'interview_feedback')) <> 2 THEN
    RAISE EXCEPTION 'interview: se esperaban exactamente dos filas';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM model_routing
    WHERE task = 'interview_questions'
      AND provider = 'anthropic' AND model = 'claude-haiku-4-5'
      AND fallback_model = 'gemini-3.5-flash'
      AND temperature = 0.5::real AND max_tokens = 800 AND thinking_level IS NULL
      AND input_usd_per_mtok = 1::real AND output_usd_per_mtok = 5::real
      AND fallback_input_usd_per_mtok = 1.5::real AND fallback_output_usd_per_mtok = 9::real
  ) THEN
    RAISE EXCEPTION 'interview_questions: la fila no quedó como se esperaba';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM model_routing
    WHERE task = 'interview_feedback'
      AND provider = 'anthropic' AND model = 'claude-sonnet-5-5'
      AND fallback_model = 'gemini-3.5-flash'
      AND temperature = 0.3::real AND max_tokens = 900 AND thinking_level IS NULL
      AND input_usd_per_mtok = 2::real AND output_usd_per_mtok = 10::real
      AND fallback_input_usd_per_mtok = 1.5::real AND fallback_output_usd_per_mtok = 9::real
  ) THEN
    RAISE EXCEPTION 'interview_feedback: la fila no quedó como se esperaba';
  END IF;
END $$;

COMMIT;
```

3. **Ensayo primero** (contra Neon, termina en `ROLLBACK`). Tiene que terminar con «OK: el ensayo corrió entero y la guarda pasó»:

   ```bash
   pnpm --filter @job-search-os/db exec tsx src/run-sql-file.ts --file "C:/Users/<usuario>/Downloads/alta-interview-routing.sql" --ensayo
   ```

4. Aplicar (pide escribir `si`) y esperar hasta 5 minutos por el caché de rutas:

   ```bash
   pnpm --filter @job-search-os/db exec tsx src/run-sql-file.ts --file "C:/Users/<usuario>/Downloads/alta-interview-routing.sql"
   ```

El equipo probó este mismo SQL contra Docker (ensayo y aplicación) y comparó el resultado con el seed: ver `packages/db/src/interview-routing-sql.integration.test.ts`.

Para volver atrás: `DELETE FROM model_routing WHERE task IN ('interview_questions', 'interview_feedback');`. Sin las filas la pantalla sigue andando pero no puede empezar simulaciones nuevas.

### 3. Evals del golden de 10 casos (paga, la corrés vos)

- El golden y el harness están en `ops/rondas/r17-tanda/R17-08/propuesta/evals/` porque `evals/` está denegado al equipo. Antes de correr, copialos **con el mismo camino relativo** (el lead puede hacerlo en el PR):
  - `propuesta/evals/fixtures/interview/golden.json` → `evals/fixtures/interview/golden.json`
  - `propuesta/evals/src/interview/cli.ts` → `evals/src/interview/cli.ts`
- El golden son 10 casos inventados de `interview_feedback` (respuesta completa, de una línea, fuera de tema, desordenada, sin acción propia, que intenta forzar un 10, con datos personales, de motivación, genérica y con una oferta de contexto). Cada caso lleva el rango esperado de cada criterio; se informan siempre la métrica **estricta** (todo en rango) y la **laxa** (cada puntaje a 1 punto).
- Circuito sin gasto (modelo simulado; los puntajes son de juguete): desde `evals/`, `pnpm exec tsx src/interview/cli.ts --modo demo`.
- **Corrida paga** (una pasada del golden): estimado como máximo USD 0,60 (10 llamadas × USD 0,06 de reserva); el costo real con Sonnet 5.5 ronda 1 o 2 centavos por llamada. Con tope de USD 2, desde `evals/`:

  ```bash
  pnpm exec tsx src/interview/cli.ts --modo modelo --max-usd 2
  ```

  Corta **antes** de la llamada que pasaría el tope y avisa «CORTADO». El reporte (solo puntajes y veredictos, sin texto del modelo) queda en `evals/reports/interview/`.
- Qué mirar: la estricta debería estar cerca de 8 de 10; los casos que más importan son `intenta-forzar-un-diez` (no puede dar 10 en todo) y `datos-personales-en-la-respuesta` (no repite la edad ni el estado civil). Si alguno falla, no cambies el prompt a mano: pasalo al evaluador.

## Variables nuevas

Ninguna. Interview usa los topes y reservas existentes (2 simulaciones por persona por día, fijo en el código).

## Textos pendientes de aprobación (diseño de marca)

Todos están en un solo archivo, `apps/web/lib/textos-rediseno.ts`: cambiar uno es una línea.

- Palabras de las barras de afinidad: «Te calza» / «Cerca» / «A medias» / «Lejos».
- Transparencia del aviso: «Aviso claro» / «Le faltan datos» / «Aviso opaco».
- Niveles del CV: «Bien» / «Mejorable» / «Falta», y el título «Cómo lo leen los sistemas de selección».
- Palabras de los puntajes de Interview: «Muy bien» / «Bien» / «Mejorable» / «A trabajar».
- Nombre de la mascota: «Tu asistente».

## Cómo se aprueban las fichas de Academy

1. Entrar a `/settings/academy` (solo admins y testers) y leer cada ficha. Hoy las 16 están en borrador; conviene empezar por monotributo, pasantías y rango salarial.
2. Para aprobar una, cambiar `estado: borrador` por `estado: aprobada` en su archivo (`apps/web/content/academy/<ficha>.md`) y publicar el cambio. Desde ese momento aparece en `/academy` y su «?» se ve junto al término en el CV y en la oferta.
3. Para corregir el texto, editar el mismo archivo (120 a 200 palabras; un test lo controla).

## Mascota

- Faltan las imágenes: `quieta`, `hablando`, `pensando`, `saludo`, `festejo` y `cara-48`, cada una en `.png` y `@2x.png`, en `apps/web/public/mascota/`.
- Al sumarlas, pasar su bandera a `true` en `apps/web/lib/mascota.ts` (un test avisa cuáles faltan). Hasta entonces se ve un marcador neutro del mismo tamaño y el botón del asistente conserva el «?».
- El nombre se cambia en `MASCOT_NAME` (arriba).

## Verificación que quedó para hacer a mano

- **Capturas a 390 y 1280 px, en claro y oscuro, y axe** de `/`, `/hoy`, `/jobs/[id]` (sello, condiciones, transparencia, «Preparar mi postulación»), `/jobs/[id]/postular`, `/cv`, `/cv/coach/charla` (dictado), `/interview`, `/academy` y `/settings/academy`. No se pudieron hacer en la tanda.
- **e2e** nuevos y ajustados (113, 125, 47, 57, 152, 153): corren en el CI. En local hacen falta usuarios de prueba (`pnpm e2e:local:prepare`).
