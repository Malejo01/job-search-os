# Evals — harness de calibración del evaluador

## Qué mide

Corre el prompt `evaluate_job@vN` con el modelo configurado en `model_routing.evaluate_job` sobre `fixtures/golden.json` y compara contra la referencia humana.

| Métrica | Cálculo | Umbral |
|---|---|---|
| `score_mae` | media de \|score_modelo − human_score\| sobre jobs con `human_score` no nulo | ≤ 1.0 |
| `blockers_recall` | por TIPO (disciplina, años, modalidad, autorización, salario, jornada, otro): Σ tipos humanos que el modelo también devolvió / Σ tipos humanos. `blockers_recall_any` (informativa) es la vieja: ≥ 1 bloqueador del tipo que sea | 100% |
| `discipline_acc` | coincidencia exacta de `disciplina` | ≥ 0.90 |
| `action_acc` | coincidencia de `accion` **después** del prefiltro y `decide()` completos de producción (descarte por modalidad/título, cap de título, bloqueador por años ≥ 8, penalizaciones, riesgos del prefiltro, tope de ubicación). `aplicar_personalizado` ≡ `aplicar` | ≥ 0.85 |
| `false_apply` | jobs con human_score ≤ 4 donde `accion ∈ {aplicar, aplicar_personalizado}` | 0 |
| `location_risk_recall` | jobs con `location_ok` humano riesgo o no donde el modelo devolvió EXACTAMENTE el mismo valor (riesgo deja aplicar, no lo frena). `location_risk_recall_any` (informativa) acepta cualquiera de los dos | 100% |
| `blockers_precision` | por TIPO: Σ tipos del modelo que el humano también tenía / Σ tipos del modelo. Un bloqueador fuera de la lista cerrada (título, inglés, país) es tipo `otro` y siempre resta | 100% |
| `risks_recall` | solo v1.1+: por TIPO (ubicación, staffing, candidatos, empresa desconocida, inglés, otro), EXCLUYENDO `salario no publicado` porque el modelo lo emite casi siempre. `risks_recall_any` (informativa) es la vieja | 100% |

**Anclas.** El prompt v1 mezclaba match y viabilidad en el score; v1.1 mide solo match. Por eso el golden tiene `human_score` (definición vieja) y `human_score_match` (match puro), más `human_blockers` y `human_risks` con la definición v1.1. Los reportes de v1 se miden contra `human_score`/`bloqueadores`; los de v1.1+ contra `human_score_match`/`human_blockers`/`human_risks`. Cada reporte informa el MAE contra las dos anclas.

Además, `prefilter_expectations` y `dedup_pairs` se testean con Vitest (sin LLM) en `packages/pipeline`.

## Cómo correr

```bash
pnpm evals run --prompt evaluate_job@v1 --model gemini-3.5-flash
pnpm evals run --prompt evaluate_job@v1 --model gemini-2.5-flash     # comparación de migración
pnpm evals compare evals/reports/2026-09-10_gemini-2.5-flash.json evals/reports/2026-09-10_gemini-3.5-flash.json
pnpm evals recompute evals/reports/<reporte>.json   # métricas y decide() de nuevo, sin llamar a la API
```

Cada reporte guarda `model_raw` (la salida cruda del modelo por oferta) y `decision` (qué hizo el prefiltro y `decide()` con ella): las métricas del MODELO (score, bloqueadores, riesgos, ubicación, disciplina) se calculan sobre lo crudo; solo la acción pasa por producción. `recompute` sirve para re-medir reportes viejos cuando cambia una métrica; en los anteriores al 2026-09-11 (sin `model_raw`) no puede reproducir el bloqueador por años ni las penalizaciones de años e inglés, y lo anota.

Flags de `run`: `--model` (default: `evaluate_job` en `seeds/model_routing.json`, sin fallback), `--runs` (default 3), `--concurrency` (default 3), `--ids 1,2,33` (subconjunto), `--subset` (solo los 14 jobs ancla: 1, 6, 7, 11, 12, 13, 14, 16, 24, 28, 30, 32, 33, 34; el reporte lleva `_subset`), `--budget N` (tope de llamadas por corrida, default 150; se aborta antes de la primera llamada si jobs × corridas lo supera, salvo `--force`), `--max-usd N` (default 1: si el costo estimado lo supera, pide confirmación en la terminal; sin terminal aborta salvo `--yes`), `--max-minutes N` (default 30: tope duro de la corrida, cancela las llamadas en curso y sale), `--thinking none|minimal|low|medium|high` (override de `model_routing.thinking_level`; va al nombre del reporte), `--db cloud|local|none` (dónde persistir las llamadas en `llm_calls` con `task = eval:<versión>` y `label`; default `cloud` si hay `DATABASE_URL`, `--local` equivale a `local`; con `none` el gasto no queda registrado), `--label paso1` (sufijo del archivo de reporte y `llm_calls.label`), `--no-report` (no escribe archivo). Antes de arrancar se compara el gasto de 24 h de `llm_calls` con `LLM_DAILY_CAP_USD`, igual que el worker. Ctrl+C / SIGTERM cancelan las llamadas en curso y salen sin dejar procesos reintentando. Un error de schema en la salida aborta la corrida entera (a temperature 0 reintentar solo repite el gasto). Los reportes se llaman `<fecha>_<modelo>_<versión-prompt>[_subset][_<thinking>][_<label>].json`. Lee `fixtures/golden.json` y los seeds de perfil y criterios; la base solo se usa para registrar el gasto (`--db none` en CI sin `DATABASE_URL`).

Al prompt entran solo datos del aviso (título, empresa, ubicación, contrato, salario, años, nivel, inglés, stack, candidatos, badges) con `had_full_jd=false`. Nunca entran `match`, `gaps`, `bloqueadores`, `senales` ni notas: son la referencia (hay un test que lo verifica). `accion` se compara después de `decide()`; `aplicar_personalizado` y `aplicar` cuentan como la misma decisión porque la referencia humana solo usa `aplicar`.

Cada corrida escribe `reports/<fecha>_<modelo>.json` con métricas y el detalle por job (score modelo, score humano, delta, veredicto). Los reportes se versionan en git.

## Cómo iterar sin quemar créditos

1. Hipótesis: `pnpm evals run --prompt evaluate_job@vX --subset --runs 1` (14 llamadas). Compará los jobs ancla.
2. Solo si la hipótesis se sostiene: corrida completa del candidato, `--runs 3` (102 llamadas, dentro del presupuesto de 150). Es la validación final y se versiona.
3. Nunca dos corridas completas en paralelo con la misma API key: la cuota se reparte y las dos tardan el doble o más.

## Determinismo

- `temperature: 0`, `seed` cuando el proveedor lo soporte.
- 3 corridas por job; se reporta la mediana del score y se marca `unstable: true` si el rango > 1.5. Un prompt con > 10% de jobs inestables no se acepta.

## Cuándo correr

- Cambio de prompt → obligatorio, en CI (`evals` job, solo si cambian `packages/prompts/**` o `evals/**`).
- Cambio de modelo en `model_routing` → obligatorio antes del UPDATE.
- Cada 2 semanas con las ofertas nuevas que Mauro puntuó a mano (`human_score` cargado desde la UI) → el golden set crece.

## Costo

Medido el 2026-09-10 con gemini-3.5-flash (USD 1,50 in / 9,00 out por millón, thinking facturado como salida): una corrida completa (102 llamadas) usa ~150–180k tokens de entrada y ~165–210k de salida, de los cuales ~85% es thinking, y cuesta **USD 1,7–2,2**. Un subset (14 llamadas) ~USD 0,30. El harness muestra la estimación antes de la primera llamada y el reporte trae `tokens_reasoning` y `cost_usd` reales. Detalle y guardarraíles en `docs/LLM_COSTOS.md`.

## Estructura

```
evals/
├── fixtures/golden.json   # dataset de ejemplo (anonimizado); el real en fixtures-private/golden.json si existe
├── run.ts            # carga fixtures, arma prompt, llama al adapter llm, guarda reporte
├── metrics.ts        # funciones puras: mae, recall, acc
├── compare.ts        # diff entre dos reportes
└── reports/          # NO versionados: la salida cruda del modelo sobre el golden real es privada (fixtures-private/reports/)
```
