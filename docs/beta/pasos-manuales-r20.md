# Pasos manuales de la tanda R20 «CV que suma puntos» (22/11)

Ninguno lo hace un agente. No hay migraciones. Con `CV_TAILOR` sin definir, producción no llama a ningún modelo nuevo: las palabras clave, los logros medibles, «Tu CV frente a esta oferta» y la descarga funcionan por código.

## 1. Fila `cv_tailor` en `model_routing` (Neon)
Hacelo antes de prender `CV_TAILOR`. Sin la fila, la versión adaptada falla cerrado y se muestra la versión sin IA.

1. Mirá que no exista: `pnpm db:sql "select task, model from model_routing where task = 'cv_tailor'"`. Tiene que dar 0 filas.
2. Guardá este SQL en `Descargas\alta-cv-tailor-routing.sql` (UTF-8 sin BOM, igual que el de Interview):

```sql
-- cv_tailor: mismos valores que la fila del seed (packages/db/seeds/model_routing.json).
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM model_routing WHERE task = 'cv_tailor') THEN
    RAISE EXCEPTION 'cv_tailor: ya existe una fila de esa tarea; mirala antes de pisarla';
  END IF;
END $$;

INSERT INTO model_routing
  (task, provider, model, fallback_model, temperature, max_tokens, thinking_level,
   input_usd_per_mtok, output_usd_per_mtok, fallback_input_usd_per_mtok, fallback_output_usd_per_mtok)
VALUES
  ('cv_tailor', 'anthropic', 'claude-sonnet-5-5', 'gemini-3.5-flash', 0.2::real, 3000, NULL,
   2::real, 10::real, 1.5::real, 9::real);

DO $$
BEGIN
  IF (SELECT count(*) FROM model_routing WHERE task = 'cv_tailor') <> 1 THEN
    RAISE EXCEPTION 'cv_tailor: se esperaba exactamente una fila';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM model_routing
    WHERE task = 'cv_tailor'
      AND provider = 'anthropic' AND model = 'claude-sonnet-5-5'
      AND fallback_model = 'gemini-3.5-flash'
      AND temperature = 0.2::real AND max_tokens = 3000 AND thinking_level IS NULL
      AND input_usd_per_mtok = 2::real AND output_usd_per_mtok = 10::real
      AND fallback_input_usd_per_mtok = 1.5::real AND fallback_output_usd_per_mtok = 9::real
  ) THEN
    RAISE EXCEPTION 'cv_tailor: la fila no quedó como se esperaba';
  END IF;
END $$;

COMMIT;
```

3. Hacé primero el ensayo, que termina en ROLLBACK: `pnpm --filter @job-search-os/db exec tsx src/run-sql-file.ts --file "<ruta>" --ensayo`.
4. Después aplicalo con el mismo comando, sin `--ensayo`. Te va a pedir que escribas `si`.

## 2. Evals de `cv_tailor` (tope USD 3)
El golden de 8 casos y el harness todavía no están en `evals/`, porque esa carpeta está cerrada para los agentes. Los agrega Claude al integrar, desde la carpeta privada de la tanda.

Con eso hecho, y con Docker abierto, corré desde la raíz:
```powershell
cd evals
pnpm exec tsx src/cv-tailor/cli.ts --modo modelo --max-usd 3
cd ..
```

- **Costo:** el estimado máximo es de USD 0,96.
- **Qué mirar en el resultado:**
  - que ningún caso pase con un dato inventado: la verificación tiene que descartarlo;
  - que los cambios tengan un «por qué» claro.

## 3. Prender `CV_TAILOR`, primero para testers
1. Antes de prender, aplicá la fila del §1 y corré los evals del §2.
2. Cargá en Vercel `CV_TAILOR` = `testers`, solo en Production. Cualquier valor que no sea `testers` o `all` la deja apagada.
3. Con una cuenta tester, abrí una oferta, entrá a «Preparar mi postulación» y pedí la versión adaptada. Revisá:
   - que diga qué cambió y por qué;
   - que se descargue el `.docx`;
   - que el cuarto pedido del día se frene con un mensaje claro.
4. Si todo da bien, más adelante pasala a `all`.

## 4. Fichas de Academy para revisar
Las revisa quien diseña la marca:
- **«Palabras clave»** (`apps/web/content/academy/palabras-clave.md`): el diagnóstico del CV ahora puntúa las palabras clave contra el mercado del puesto. Conviene que la ficha explique de dónde salen esas palabras y qué pasa con «Sin datos suficientes».
- **«Logros medibles»:** no hay ficha. El diagnóstico ahora puntúa las viñetas con resultado medible. Conviene escribirla y revisarla, siguiendo el formato del resto, en borrador hasta que se apruebe.

## 5. Proceso colgado en la máquina local
Durante la tanda quedó un `node.exe` al 100% de CPU, con `vitest run src/cv-tailor` en la línea de comandos. Cerralo desde el Administrador de tareas: el guard no deja que lo cierre un agente. La causa ya está arreglada en R20-06.
