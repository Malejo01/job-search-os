# Pasos manuales de la tanda R6

Cosas que solo puede hacer Mauro: aplicar SQL en Neon, cargar variables, abrir PRs. Cada sección dice qué ticket la pide.

## §1. Fila `extract_job_from_image` en `model_routing` (R6-3)

**Qué es.** «Cargar una oferta desde una imagen» (`/jobs/new?modo=pegar`) lee su modelo de `model_routing`, tarea `extract_job_from_image`. **Sin fila falla cerrado (`no_route`):** la persona ve «No pudimos leer la imagen» y puede pegar el texto como siempre. `packages/db/seeds/model_routing.json` del PR trae la fila, con los mismos valores del SQL de abajo. **No se corre `pnpm db:seed`** en producción (reescribe perfil y golden): se aplica este SQL.

**Valores (iguales a la fila del seed).**

- Principal: Gemini 3.5 Flash (Google), `thinking_level = minimal`, temperatura 0, `max_tokens = 4096`.
- Respaldo: Sonnet 5.5 (Anthropic). Ambos modelos leen imágenes.
- Tarifas: solo las del seed (Gemini 3.5 Flash: 1,5 / 9; Sonnet 5.5: 2 / 10). Un test del repo exige que la tarifa de un modelo sea la misma en todas las filas.
- Prompt: `extract_job_from_image@v1` (`packages/prompts/extract_job_from_image.v1.md`).
- Topes: la llamada cuenta para `LLM_USER_DAILY_CAP_USD` y para el tope global, y hay un máximo de 10 imágenes por persona cada 24 h (se cuentan las filas de `llm_calls` de esta tarea). **No hace falta migración.**
- Costo esperado: una captura reducida a 1600 px son unos 1 500 tokens de entrada más el prompt, y la salida lleva el texto del aviso: del orden de USD 0,01 por imagen. Con el tope de 10 por día, menos de USD 0,10 por persona y por día.

**SQL** (archivo `alta-extract-job-from-image.sql`). Si hoy ya hay una fila de esta tarea, la guarda frena el ensayo.

```sql
-- extract_job_from_image: mismos valores que la fila del seed del PR R6-3. Modelos y tarifas solo del seed.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM model_routing WHERE task = 'extract_job_from_image') THEN
    RAISE EXCEPTION 'extract_job_from_image: ya existe una fila; mirala antes de pisarla';
  END IF;
END $$;

INSERT INTO model_routing
  (task, provider, model, fallback_model, temperature, max_tokens, thinking_level,
   input_usd_per_mtok, output_usd_per_mtok, fallback_input_usd_per_mtok, fallback_output_usd_per_mtok)
VALUES
  ('extract_job_from_image', 'google', 'gemini-3.5-flash', 'claude-sonnet-5-5', 0::real, 4096, 'minimal',
   1.5::real, 9::real, 2::real, 10::real);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM model_routing
    WHERE task = 'extract_job_from_image'
      AND provider = 'google' AND model = 'gemini-3.5-flash'
      AND fallback_model = 'claude-sonnet-5-5'
      AND temperature = 0::real AND max_tokens = 4096 AND thinking_level = 'minimal'
      AND input_usd_per_mtok = 1.5::real AND output_usd_per_mtok = 9::real
      AND fallback_input_usd_per_mtok = 2::real AND fallback_output_usd_per_mtok = 10::real
  ) THEN
    RAISE EXCEPTION 'extract_job_from_image: la fila no quedó como se esperaba';
  END IF;
END $$;

COMMIT;
```

**Pasos.**

1. Antes, mirá si hay fila (solo lectura): `pnpm db:sql "select * from model_routing where task = 'extract_job_from_image'"`. Esperado: 0 filas.
2. Guardá el SQL en Descargas como `alta-extract-job-from-image.sql`.
3. **Ensayo primero** (contra Neon, termina en `ROLLBACK`):

   ```bash
   pnpm --filter @job-search-os/db exec tsx src/run-sql-file.ts --file "C:/Users/<usuario>/Downloads/alta-extract-job-from-image.sql" --ensayo
   ```

   Tiene que terminar con «OK: el ensayo corrió entero y la guarda pasó».
4. Aplicar (pide escribir `si`):

   ```bash
   pnpm --filter @job-search-os/db exec tsx src/run-sql-file.ts --file "C:/Users/<usuario>/Downloads/alta-extract-job-from-image.sql"
   ```

5. Esperá hasta 5 minutos (caché de rutas).

**Cómo verificar.** La consulta del paso 1 devuelve la fila. En `/jobs/new?modo=pegar`, subir una captura de un aviso inventado muestra los campos para revisar (no `no_route`), y `pnpm llm:spend --days 1` lista la tarea `extract_job_from_image`.

**Cuánto tarda.** 10 minutos.

## §2. Abrir el PR de R6-3 a mano (no lo abre el equipo)

El prompt nuevo está en `packages/prompts/`, y todo PR que toca esa carpeta corre el job `evals` del CI (unos USD 0,16 por push, con tope de USD 0,5), que no mide nada de este ticket. Sin OK de Mauro para ese gasto, la rama se pushea pero **el PR no se abre**. El título y el cuerpo quedan en `ops/rondas/r6-tanda/R6-3/` (`pr-title.txt`, `pr-body.md`). Para abrirlo, con el OK del gasto:

```bash
gh pr create --draft --base main --head ronda/r6-3-imagen --title "<contenido de pr-title.txt>" --body-file ops/rondas/r6-tanda/R6-3/pr-body.md
```

Es carril rojo (`packages/prompts/**`, `packages/adapters/src/llm/**`, `packages/db/seeds/**`, `packages/db/src/**`, `apps/web/app/**/actions.ts`): lo mergea Mauro.
