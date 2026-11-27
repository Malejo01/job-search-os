# Pasos manuales de la R31

Lo que tiene que hacer el responsable del proyecto. Ningún agente toca Neon, Vercel ni mergea. Informe de la tanda: `docs/beta/informe-r31.md`. Los pasos van **en este orden**: cada uno depende del anterior.

## 1. Integrar la rama de cierre (carril rojo)

La tanda toca archivos del carril rojo, por eso el PR de cierre no lo mergea ningún agente: revisalo y mergealo en GitHub. Lista de la tanda (el lead la comprueba contra `gh pr diff <n> --name-only` y `.github/carril-rojo.txt`):

- **Base de datos:** `packages/db/schema.ts`; `packages/db/drizzle/0087_*`, `0088_*` y `meta/` (snapshots y journal); `packages/db/rls/0071_job_cards.sql`, `0072_requirement_answers.sql`, `0073_calibration_marks.sql`; `packages/db/seeds/model_routing.json` (fila `extract_job_card`); en `packages/db/src/`: `user-tables.ts`, `job-cards.integration.test.ts`, `requirement-answers.integration.test.ts`, `calibration-marks.integration.test.ts`, `job-card-routing-seed.test.ts`, `multiusuario.integration.test.ts` y `delete-account.integration.test.ts`.
- **Prompts y evaluador:** `packages/prompts/extract_job_card.v1.md`, `packages/prompts/evaluate_job.v1.5.0.md` y `packages/prompts/src/extract-job-card-prompt.test.ts`; `packages/pipeline/src/evaluation.ts`; `packages/pipeline/src/evaluator/` (`checklist.ts`, `wire.ts`, `ficha-prompt.ts` y sus tests); `packages/pipeline/src/job-card/flag.ts`.
- **Worker, modelos y retención:** `packages/adapters/src/worker/evaluate-job.ts`; `packages/adapters/src/llm/` (`job-card-reserve.ts`, `spend-reserve.ts`, `demo.ts`, `demo-job-card.ts` y los tests nuevos); `packages/adapters/src/reevaluate/reevaluate-cli.ts`; `packages/adapters/src/retention/job-cards.ts`.
- **App:** `apps/web/lib/job-card.ts` (usa el rol de servicio); acciones nuevas `apps/web/app/(app)/jobs/[id]/ficha-actions.ts`, `repetido-actions.ts` y `requirement-answer-actions.ts`; ruta nueva `apps/web/app/(app)/admin/calibracion/export/route.ts`; `apps/web/lib/route-access.ts`; `apps/web/playwright.config.ts`.
- **CI y dueños:** `.github/carril-rojo.txt` y `.github/CODEOWNERS` (suman `apps/web/lib/job-card.ts`, `packages/pipeline/src/job-card/flag.ts` y `packages/adapters/src/reevaluate/reevaluate-cli.ts`). Las tres acciones nuevas ya las cubre el patrón `apps/web/app/**/*-actions.ts`.

Los e2e de `apps/web/e2e/` y el resto de lo de `docs/` y `apps/web` no son carril rojo.

## 2. Migraciones y RLS en Neon

Tres piezas, **en este orden**, cada una con su verificación de solo lectura antes de seguir. Aplicalas con el script de migraciones del repo contra Neon, confirmando con `si` como pide el script, y solo después de revisar el SQL. Nunca `db:seed`.

| Orden | Pieza | Qué hace |
|---|---|---|
| 1 | Migración `0087_*` y RLS `0071_job_cards.sql` | Tabla `job_cards` (una fila por texto, sin `user_id`). La app solo lee; escribe el rol de servicio por policies `TO CURRENT_USER` |
| 2 | Migración `0088_*` y RLS `0072_requirement_answers.sql` | Tabla `requirement_answers` (respuestas de un toque, con `user_id` y borrado en cascada con la cuenta) |
| 3 | RLS `0073_calibration_marks.sql` | Función `admin_calibration_marks` (solo admins, sin datos personales). No crea tablas |

**Antes de nada, confirmá que el rol que aplica la migración no es `jobsearch_app`.** Las policies `TO CURRENT_USER` de la 0071 dependen de eso: si coincidieran, la app podría escribir en `job_cards` y plantar una ficha falsa. Solo lectura:

```sql
SELECT current_user AS rol_de_migracion;
SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('jobsearch_app', current_user);
```

`rol_de_migracion` tiene que ser distinto de `jobsearch_app`. Si es el mismo, frená y no sigas.

Verificación de solo lectura después de cada pieza:

```sql
-- Después de 0087 + 0071: la tabla, la restricción única, RLS activa y forzada, y el permiso de la app
SELECT relrowsecurity, relforcerowsecurity FROM pg_class
 WHERE relname = 'job_cards' AND relnamespace = 'public'::regnamespace;       -- true, true
SELECT indexname FROM pg_indexes WHERE tablename = 'job_cards';                -- incluye job_cards_jd_hash
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'job_cards';        -- lectura de la persona y de servicio
SELECT privilege_type FROM information_schema.role_table_grants
 WHERE table_name = 'job_cards' AND grantee = 'authenticated';                -- solo SELECT

-- Después de 0088 + 0072
SELECT relrowsecurity, relforcerowsecurity FROM pg_class
 WHERE relname = 'requirement_answers' AND relnamespace = 'public'::regnamespace;   -- true, true
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'requirement_answers';     -- select, insert, update, delete (dueña)

-- Después de 0073
SELECT has_function_privilege('public', 'public.admin_calibration_marks(integer)', 'EXECUTE');  -- false
SELECT has_function_privilege('authenticated', 'public.admin_calibration_marks(integer)', 'EXECUTE');  -- true
```

Qué pasa si no se aplican: con `JOB_CARD` apagada, nada (no se consulta ninguna tabla nueva). Con `JOB_CARD` encendida, el detalle y el worker fallan al leer `job_cards` y `requirement_answers`. Aplicalas **antes** de desplegar el código y antes de encender la variable.

## 3. La fila de `model_routing` para la ficha

`db:seed` no (reescribe perfil y golden). Se agrega con un `INSERT` puntual, que no pisa nada si la fila ya existe. El archivo está en `ops/rondas/r31-tanda/r31-02/propuesta/ruteo-extract-job-card.sql` (privado, fuera del repo); su contenido:

```sql
BEGIN;

INSERT INTO model_routing (task, provider, model, fallback_model, temperature, max_tokens, thinking_level,
  input_usd_per_mtok, output_usd_per_mtok, fallback_input_usd_per_mtok, fallback_output_usd_per_mtok, updated_at)
VALUES ('extract_job_card', 'anthropic', 'claude-haiku-4-5', 'gemini-3.5-flash', 0::real, 3500, NULL,
  1::real, 5::real, 1.5::real, 9::real, now())
ON CONFLICT (task) DO NOTHING;

-- Guarda final: la fila quedó exactamente como el seed
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM model_routing
    WHERE task = 'extract_job_card' AND provider = 'anthropic' AND model = 'claude-haiku-4-5'
      AND fallback_model = 'gemini-3.5-flash' AND temperature = 0 AND max_tokens = 3500
      AND thinking_level IS NULL AND input_usd_per_mtok = 1 AND output_usd_per_mtok = 5
      AND fallback_input_usd_per_mtok = 1.5 AND fallback_output_usd_per_mtok = 9
  ) THEN
    RAISE EXCEPTION 'extract_job_card: la fila no quedó como el seed; revisala antes de seguir';
  END IF;
END $$;

COMMIT;
```

Cómo correrlo: primero el ensayo (termina en `ROLLBACK` y no deja nada) y después sin él, confirmando con `si`:

```
pnpm --filter @job-search-os/db exec tsx src/run-sql-file.ts --file <ruta al archivo> --ensayo
pnpm --filter @job-search-os/db exec tsx src/run-sql-file.ts --file <ruta al archivo>
```

Verificación de solo lectura: `SELECT task, model, fallback_model, max_tokens FROM model_routing WHERE task = 'extract_job_card';` devuelve una fila (`claude-haiku-4-5`, `gemini-3.5-flash`, 3500). Sin esta fila la ficha no se puede generar (queda `fallida`).

## 4. Comandos de las evals

Ninguna eval se corrió en la tanda (USD 0). Corren en este orden, con el estimado que muestra el comando y su tope `--max-usd`. **Son pagas:** miralas antes de confirmar.

**a) `evaluate_job@v1.5.0` con el golden propuesto** (24 casos, 8 carreras, en `ops/rondas/r31-tanda/R31-06/propuesta/`, con su `LEEME.md`):

```
copy ops\rondas\r31-tanda\R31-06\propuesta\golden-r31-v150.json evals\fixtures\golden-r31-v150.json
pnpm evals run --prompt evaluate_job@v1.5.0 --fixture golden-r31-v150 --runs 1 --max-usd 1 --label r31-v150
pnpm evals run --prompt vigente --fixture golden-r31-v150 --runs 1 --max-usd 1 --label r31-vigente
pnpm evals compare evals/reports/<vigente>.json evals/reports/<v150>.json
```

Estimado: unos USD 0,40 por corrida de 24 llamadas (ver el costo en `docs/beta/informe-r31.md`; es una cuenta con supuestos, el comando muestra el suyo).

**b) Control con los casos de siempre**, para comprobar que v1.5.0 no empeora lo que ya andaba:

```
pnpm evals run --prompt evaluate_job@v1.5.0 --runs 1 --max-usd 2
pnpm evals run --prompt vigente --runs 1 --max-usd 2
```

**c) La ficha (`extract_job_card@v1`).** No hay golden de la ficha (no estaba en el alcance). Hasta tenerlo, la calidad se mira con avisos reales en la calibración del paso 6: cada ficha trae su cita y el código descarta lo que no verifica. Si se arma un golden de fichas, se corre con el mismo comando y `--prompt extract_job_card@v1`.

Los anclas del golden propuesto son sintéticos: revisalos (o pedile a quien conozca cada carrera) antes de usarlos para decidir. Medir v1.5.0 **con** ficha pide un parche en `evals/src/golden.ts` (carpeta denegada para el equipo); con el golden actual el prompt recibe «FICHA NO DISPONIBLE».

## 5. Encender `JOB_CARD=testers` y los topes

Variables nuevas (en Vercel, solo después de los pasos 2 y 3):

| Variable | Valor | Para qué |
|---|---|---|
| `JOB_CARD` | `testers` | Enciende la ficha para admins y testers. `all` para todas las personas **no** hasta tener un ritmo por persona (hoy el tope de fichas es global). Cualquier otro valor es apagado |
| `JOB_CARD_DAILY_MAX` | opcional, por defecto 100 | Fichas nuevas por 24 horas. `0` = ninguna ficha nueva |
| `JOB_CARD_DAILY_USD` | opcional, por defecto 1 | Gasto de fichas por 24 horas, en USD |

Con la variable apagada la app se ve y se comporta igual que al cerrar la R30. Al tope, el detalle dice «Hoy llegamos al límite de resúmenes» y el resto de la app sigue.

Para ver el gasto de fichas: en `llm_calls`, las filas con `task = 'extract_job_card'` (con `user_id` nulo: nadie las pidió).

## 6. La calibración con la revisora

Con `JOB_CARD=testers` y las ofertas de quien revisa evaluadas con la versión nueva (se consigue con el paso 8, o con una prueba chica de pocas ofertas):

1. Pasale la URL **`/calibracion`** (no hay link de entrada). Solo la ven admins y testers con la variable encendida; el resto recibe 404.
2. Que marque entre 20 y 30 ofertas variadas, con «¿Te sirve esta evaluación?» y, si hace falta, «Proponer otro puntaje». La guía de qué mirar en cada una está en `docs/beta/calibracion-r31.md`.
3. Exportá lo marcado desde el botón «Exportar lo marcado (CSV)» de la misma pantalla (solo admins). El CSV sale sin email, nombre ni datos del perfil, y con emails, teléfonos y enlaces del motivo enmascarados.
4. Leé el resultado **por carrera**, no solo el total, y los motivos del «No». Cada grupo de motivos es una corrección de prompt o de código.

## 7. Promover `evaluate_job` v1.5.0

Solo con el resultado del paso 4 y del paso 6 a favor. Hoy producción corre `evaluate_job@v1.3.4` y **no hay nada que promover automáticamente**. Promover es cambiar `DEFAULT_PROMPT_VERSIONS.evaluate_job` en `packages/adapters/src/llm/client.ts` a `evaluate_job@v1.5.0` (carril rojo, PR aparte). Al promoverla, el worker ya le pasa la ficha al prompt; con `JOB_CARD` apagada recibe «FICHA NO DISPONIBLE» y lee todo del aviso. El parser sigue leyendo las evaluaciones viejas.

## 8. La reevaluación única, con su tope

Para no convivir con dos formatos. Recién con `JOB_CARD` encendida y la v1.5.0 promovida. **Dry-run primero** (no llama a ningún modelo ni escribe nada): cuántas son, cuántas ya tienen la versión nueva y el estimado.

```
pnpm --filter @job-search-os/adapters exec tsx src/reevaluate/reevaluate-cli.ts
```

Después, con tope obligatorio (el estimado más un margen; el máximo aceptado es USD 50):

```
pnpm --filter @job-search-os/adapters exec tsx src/reevaluate/reevaluate-cli.ts --execute --max-usd <USD>
```

- Se puede cortar con Ctrl+C y repetir el mismo comando: retoma por las que faltan. El estado queda en `ops/reevaluacion/estado-<versión>.json` (fuera del repo).
- Contra Neon pide escribir `si`.
- Revisá la comparación antes y después. Si no convence: `--rollback` (dry-run) y después `--rollback --execute`. No borra una evaluación nueva sobre la que la persona ya opinó.
- «Abiertas» son las `evaluada`; las que tienen una postulación en curso quedan fuera a propósito.
- Cada reevaluación genera antes la ficha del aviso si falta, con los topes del paso 5.

## 9. Limpieza de fichas huérfanas

Una ficha sale del texto de un aviso; el texto de un aviso pegado sobrevive a la oferta y a la cuenta. `purgeOrphanJobCards` (en `packages/adapters/src/retention/job-cards.ts`) borra las fichas más viejas de 24 horas cuyo hash ya no está en ninguna oferta ni en el pool. Una ficha que se vuelve a pedir se vuelve a generar. Está probada, **pero todavía no está programada** en ningún cron: queda pendiente decidir cada cuánto correrla (una vez por semana alcanza) y sumarla a la retención. No es urgente para la prueba con testers.

## 10. Lo que no se pudo verificar

- **Ningún modelo se llamó:** la calidad real del prompt de la ficha y de `evaluate_job@v1.5.0`, el costo real por ficha y por evaluación y el tamaño real del prompt con la ficha son supuestos hasta la primera corrida (pasos 4 y 6).
- **El informe de revisión en PDF** no se pudo leer en la máquina del equipo: los textos marcados `PENDIENTE-INFORME` en `apps/web/lib/textos-rediseno.ts` (R-25 a R-29, S-02, S-05 a S-07, entre otros) están sin cotejar. Para cerrarlo: pasar el PDF a texto fuera del equipo y cotejar los IDs.
- **Que el rol de migración no sea `jobsearch_app` en Neon:** no se pudo comprobar desde el equipo; es la primera verificación del paso 2.
- **La lectura de la ficha en producción:** la ficha se lee con RLS por el hash del texto de la oferta; una oferta con texto y sin hash queda en «Preparando». Mirá un par de ofertas viejas después de encender la variable.
- **Los e2e, el teclado, axe y las capturas a 390 y 360 px** los corre el lead y quedan anotados en `docs/beta/informe-r31.md`.
- **La reevaluación y el rollback** solo se probaron con el modelo simulado en una base de pruebas.
- **El ritmo por persona** de las fichas no existe: antes de `JOB_CARD=all`, una cuenta podría agotar el tope diario.
