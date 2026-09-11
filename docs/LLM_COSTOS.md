# Costos LLM: qué pasó el 2026-09-10 y qué lo frena ahora

## Diagnóstico (USD 14 en dos días con Gemini 3.5 Flash)

Tarifas vigentes (lista, por millón de tokens; el thinking se factura como salida, sin tarifa aparte):

| Modelo | Entrada | Salida (incluye thinking) |
|---|---|---|
| gemini-3.5-flash | 1,50 | 9,00 |
| gemini-2.5-flash | 0,30 | 2,50 |
| gemini-3.1-flash-lite | 0,25 | 1,50 |
| claude-haiku-4-5 | 1,00 | 5,00 |
| claude-sonnet-5 | 2,00 | 10,00 |

**`gemini-3.5-flash` no es un modelo barato.** A USD 9 la salida está en el orden de un modelo de gama alta, no de un "Flash". Toda la tabla de `model_routing` se armó sobre el supuesto "flash = barato, para todo", y ese supuesto era falso.

Lo que se reconstruyó (hasta esta rama las corridas de evals no escribían en `llm_calls`; los números salen de `evals/reports/*.json` y de los logs de la sesión):

| Corrida | Llamadas | Tokens in | Tokens out | USD |
|---|---|---|---|---|
| v1 baseline, 3.5-flash | 102 | 142.968 | 170.833 | 1,75 |
| v1 baseline, 2.5-flash | 112 | 142.968 | 376.510 | 0,98 |
| v1 paso 1 (fixture) | 102 | 142.173 | 165.871 | 1,71 |
| v1 paso 2 (perfil v2, rama) | 102 | 154.311 | 167.782 | 1,74 |
| v1.1 paso 3b | 102 | 179.403 | 209.244 | 2,15 |
| **Con reporte** | **520** | | | **8,33** |
| Corrida v1 huérfana (13:38–15:01, bug de schema, reintentos en loop) | hasta 408 | | | hasta ~7,00 |
| Corridas abortadas por `max_tokens` 2048 (00:56) y por créditos agotados (15:18) | pocas / 0 facturadas | | | < 0,50 |

- **Salida por llamada:** 1.675 tokens (v1) a 2.051 (v1.1). El JSON de una evaluación mide ~170–290 tokens. **El 85–90% de la salida es thinking**, cobrado a USD 9 por millón. De cada llamada de v1.1 (~USD 0,021), USD 0,0185 es salida y de eso ~USD 0,016 es thinking.
- **La corrida huérfana:** la corrida v1 lanzada a las 13:38 con el bug de re-parseo del schema recibía una respuesta válida (facturada), la rechazaba en cliente y reintentaba 4 veces por unidad (102 unidades). `TaskStop` no mató los `node` hijos en Windows; siguió hasta que se la mató a mano a las 15:01. No dejó reporte ni fila en `llm_calls`.
- **Lo no registrado:** todo lo de evals (sink en memoria, corregido en esta rama) más la huérfana. Todas las llamadas pasaron por el adapter: no hubo llamadas fuera de él.

## Una key por producto

El hallazgo del thinking aplica a cualquier otro producto con `gemini-3.5-flash` (por ejemplo Qué Pinta Salta, Tuki o MaestrIA, del mismo autor): el mismo cambio (`thinking_level: minimal` o un modelo más barato) se mide con este harness y un golden propio por proyecto. Regla que quedó de esto: **un proyecto de Google Cloud por producto, cada uno con su key y su presupuesto con alertas**; una key compartida hace que el gasto de un harness se mezcle con el de producción de otro producto y que un saldo en cero apague todo a la vez. Este repo usa su propia key.

## Costo mensual proyectado por combinación

Supuestos: 1.800 tokens de entrada por evaluación (perfil + criterios + aviso); salida 2.050 con thinking alto (medido) y 430 con `minimal` (medido el 2026-09-11: 0 tokens de thinking). Solo `evaluate_job`; `extract_skills` y `parse_email_fallback` se suman después con sus propias mediciones. 30 días.

| Modelo × thinking | USD / evaluación | 10 / día | 20 / día | 40 / día |
|---|---|---|---|---|
| gemini-3.5-flash, thinking default | 0,0212 | 6,35 | 12,71 | 25,42 |
| gemini-3.5-flash, minimal | 0,0068 | 2,04 | 4,08 | 8,16 |
| gemini-3.1-flash-lite, thinking default | 0,0035 | 1,06 | 2,11 | 4,23 |
| gemini-3.1-flash-lite, minimal (probado el 2026-09-11; descartado para evaluate_job por ubicación, candidato para extract_skills) | 0,0013 | 0,39 | 0,77 | 1,54 |
| claude-haiku-4-5 (fallback), sin thinking | 0,0038 | 1,14 | 2,28 | 4,56 |

Lectura: con 3.5-flash y thinking alto, 15 ofertas por día son ~USD 9,50 al mes, el doble de la métrica del PRD (< USD 5). Con `minimal` entra (USD 2,8 a 15/día) pero sin margen para 40/día. `flash-lite` con `minimal` es 6 veces más barato que 3.5-flash con `minimal`; si el subset da métricas comparables, pasa a primario y 3.5-flash queda de fallback.

## Guardarraíles (en `main`)

1. **`llm_calls.tokens_reasoning`** (migración 0007): el adapter registra los tokens de thinking aparte (`usage.outputTokenDetails.reasoningTokens` del AI SDK; en Gemini es `thoughtsTokenCount`). `tokens_out` sigue siendo lo facturado (texto + thinking).
2. **Tarifas reales en `model_routing`** (`seeds/model_routing.json`): entrada, salida y las del fallback (`fallback_*_usd_per_mtok`). `cost_usd` deja de ser null, también para el fallback.
3. **Estimación previa en evals:** `pnpm evals run` muestra `llamadas × tokens por llamada × tarifa` antes de la primera llamada y dice de dónde salieron los tokens: (1) promedio de las últimas 50 llamadas ok del mismo modelo en `llm_calls`, separadas por si gastaron thinking (mínimo 5), (2) si no hay historia, el promedio medido por modelo y nivel de thinking (`MEASURED_TOKENS_PER_CALL` en `evals/src/run.ts`), (3) si tampoco, el supuesto conservador del caso caro (2.100 de salida con thinking). Si supera `--max-usd` (default 1) pide confirmación, y sin terminal aborta salvo `--yes`. El reporte trae `tokens_reasoning` y `cost_usd` reales. Antes de este arreglo asumía siempre el caso caro y estimaba 3× arriba de lo real con `minimal`.
4. **Evals escriben en `llm_calls`** (migración 0008): `task = eval:<versión de prompt>`, `label = --label`, `job_id` null. `--db cloud|local|none`; sin `DATABASE_URL` avisa y no registra. Antes de arrancar aplica el mismo tope de 24 h que el worker.
5. **Tope diario del worker:** `LLM_DAILY_CAP_USD` (default 2, 0 = sin tope) sobre las últimas 24 h móviles de `llm_calls` (evals incluidos). Se mira antes de tomar mensajes y entre mensajes; lo no procesado vuelve a `pending` sin consumir intento (`queue.release`). `pnpm llm:spend [--local] [--days 7]` muestra el acumulado y el desglose por día/tarea/modelo. Aplica al CLI y al cron `/api/cron/evaluate`.
6. **Nada queda huérfano:** timeout duro por llamada (`LLM_CALL_TIMEOUT_MS`, default 90 s, vía `AbortSignal`), tope de corrida (`--max-minutes`: 30 en evals, 15 en el worker; el timer mantiene vivo el proceso hasta que dispara) y Ctrl+C / SIGTERM que cancelan la llamada en curso y salen. Un error de schema en evals aborta la corrida entera: a temperature 0 reintentar solo repite el gasto. Probado en Windows con `LLM_FAKE_GENERATE=hang` (proveedor colgado): ver "Verificación" abajo.
7. **`thinking_level` en `model_routing`** (migración 0008): `minimal` para `evaluate_job`, `extract_skills` y `parse_email_fallback`; null (default del proveedor) para las tareas de Claude. Vocabulario del AI SDK (`none | minimal | low | medium | high`), que el SDK traduce a `thinkingLevel` en Gemini 3.x y a `thinkingBudget` en 2.5. Para `gemini-3.5-flash` el piso es `minimal`: no se apaga del todo. Override por corrida: `pnpm evals run --thinking none`.

## Calibración del 2026-09-11 (key propia con saldo, `--concurrency 1`)

Todo con `thinking_level: minimal`. Gasto total de la secuencia: **USD 0,228 en 59 llamadas** (tope acordado: USD 1). Reportes en `evals/reports/2026-09-11_*`; filas en `llm_calls` con labels `prueba-*` y `paso-c-*`.

**Con `minimal`, Gemini 3.x no gasta thinking:** `tokens_reasoning = 0` en las 59 llamadas. La salida completa de una evaluación mide 370–440 tokens.

| Corrida (14 anclas) | in/llamada | out/llamada | USD corrida | USD/eval | latencia media | p50 | máx |
|---|---|---|---|---|---|---|---|
| v1.1 × 3.5-flash | 1.894 | 433 | 0,094 | 0,0067 | 2,45 s | 2,4 s | 3,4 s |
| v1.2 × 3.5-flash | 2.056 | 418 | 0,096 | 0,0068 | 2,40 s | 2,4 s | 2,7 s |
| v1.1 × flash-lite | 1.894 | 415 | 0,015 | 0,0011 | 2,17 s | 2,1 s | 2,8 s |
| v1.2 × flash-lite | 2.056 | 386 | 0,015 | 0,0011 | 2,10 s | 2,0 s | 2,7 s |

Latencia: en 14 llamadas flash-lite fue 0,3 s más rápido, no más lento; los 5,9 s de la llamada suelta fueron arranque en frío (la primera de 3.5-flash tardó 3,4 s y luego 2,4 s). Irrelevante para el worker en ambos casos.

| Métrica | v1.1 × 3.5 | v1.2 × 3.5 | v1.1 × lite | v1.2 × lite |
|---|---|---|---|---|
| score_mae (ancla) | 1,11 | **1,07** | 1,25 | 1,29 |
| blockers_recall | 100 % | 100 % | **75 %** | **75 %** |
| blockers_precision | 80 % | 80 % | 75 % | 60 % |
| risks_recall | 100 % | 100 % | 100 % | 100 % |
| discipline_acc | 100 % | 100 % | 93 % | 100 % |
| action_acc | 57 % | 64 % | 71 % | 64 % |
| false_apply | 0 | 0 | **1** | **1** |
| location_risk_recall | 50 % | 50 % | 50 % | 50 % |
| JSON inválidos | 0 | 0 | 0 | 0 |

**Criterio para que flash-lite pase a primario** (MAE no empeora más de 0,3; blockers_recall 100 %; risks_recall ≥ 90 %; cero JSON inválidos): cumple MAE (+0,14 / +0,22), riesgos y JSON, pero **falla blockers_recall (75 %)** en los dos prompts, y con un falso "aplicar". No pasa.

Desacuerdos de más de 1 punto entre flash-lite y 3.5-flash sobre el mismo prompt (lite − 3.5), los mismos en v1.1 y v1.2, o sea sistemáticos y no ruido:

| id | Oferta | Ancla | v1.1: 3.5 / lite | v1.2: 3.5 / lite | Qué pasa |
|---|---|---|---|---|---|
| 11 | Empresa J (disciplina ai_evaluation) | 3, descartar | 4 / **7** | 4 / **8** | flash-lite no ve el bloqueador de disciplina y dice "aplicar" (el falso apply). Frontera de disciplina: el caso que más importa. |
| 1 | Empresa A (Staff, 8+ años) | 8, guardar | 6,5 / 4 | 7,5 / 6 | flash-lite trata la seniority como bloqueador duro; 3.5 también castiga pero menos. |
| 14 | Empresa M (híbrido CABA) | 5,5, descartar | 7,5 / 5 | 7,5 / 6 | flash-lite más cerca del humano; 3.5 sobrevalora el match técnico. |
| 24 | Empresa S (Azure / Semantic Kernel) | 5,5, guardar | 7,5 / 6 | 7,5 / 6 | flash-lite más cerca del humano. |
| 32 | Empresa Z (ubicación en conflicto) | 8, guardar | 7,5 / 6 | 7,5 / 7 | flash-lite castiga más la ubicación (solo en v1.1). |

Lectura: flash-lite es más severo con restricciones duras (seniority, ubicación) y más frío con el match técnico, lo que lo acerca al humano en 14 y 24, pero no aplica el bloqueador de disciplina en la frontera ML/evaluación (Empresa J), y ese es el error que el sistema no puede cometer. Queda anotado como intento; se repite cuando haya un prompt que refuerce disciplina o con `low` de thinking (a medir).

**Decisión (paso E, aplicada el 2026-09-11):** `gemini-3.5-flash` con `minimal` sigue de primario; prompt de producción v1.2 (`DEFAULT_PROMPT_VERSIONS`) (MAE 1,07 vs 1,11, action_acc 64 % vs 57 %, y 2 desacuerdos de ubicación contra 4). Costo real: **USD 0,0068 por evaluación**, que a 20 por día son USD 4,08 al mes (entra en la métrica del PRD de < USD 5; a 40 por día serían 8,2). `max_tokens` de `evaluate_job` vuelve a 2048 (5× la salida medida).

### Hipótesis para un v1.3 (anotada, sin implementar)

En 3 de los 5 desacuerdos de más de 1 punto (Empresa M, Empresa S, y Empresa A en parte) flash-lite quedó MÁS cerca del criterio humano que 3.5-flash; solo falla en disciplina (Empresa J, frontera ai_evaluation). Si un v1.3 refuerza el chequeo de disciplina como paso explícito ANTES de puntuar (primero "¿la disciplina del rol está en las permitidas? si no, bloqueador y fin", después el score de match), flash-lite podría pasar el corte y el evaluador costaría 6 veces menos (USD 0,0011 por evaluación, USD 0,66 al mes a 20 por día). Probarlo cuando haya ofertas reales acumuladas, con el subset ampliado (más casos de frontera de disciplina, no solo Empresa J), con los dos modelos y el mismo criterio del paso D.

### Deudas que ninguno de los dos prompts resuelve (diagnóstico del 2026-09-11, sin arreglar)

**a. `location_risk_recall` 50 %.** En el subset solo dos ofertas tienen ubicación humana riesgo/no (Empresa O 16 y Empresa Z 32); el 50 % es un solo fallo, siempre Empresa O. Es un problema de definición, no de modelo:

| id | ubicacion_raw | golden (`human_location_ok`) | modelo (4 corridas) |
|---|---|---|---|
| 16 Empresa O | "Argentina (remoto)" | riesgo ("LATAM/remoto sin países explícitos") | ok, ok, ok, ok |
| 14 Empresa M | "Argentina (híbrido, visitas a CABA)" | ok (la modalidad no entra en location_ok) | riesgo, no, riesgo, ok |
| 32 Empresa Z | "Argentina (remoto) en LinkedIn; aviso original: US, BR, CA" | no | riesgo, no, no, no |

Empresa O contradice la propia regla del golden ("ok = AR explícito"): el texto dice Argentina, así que por definición es ok; la anotación "riesgo" viene de `paises: null` del aviso original, que el prompt no ve. Empresa M no cuenta en el recall pero aparece como desacuerdo: el prompt v1.2 (líneas 37–38) solo define riesgo para LATAM y no para lista sin AR; nunca dice que la modalidad NO afecta `location_ok`, y el modelo la mezcla en 3 de 4 corridas. Empresa Z está bien (riesgo y no cuentan ambos como detectado). Arreglo probable: corregir el golden de 16 (o poner `ubicacion_raw` sin "Argentina") y una línea en el prompt: "híbrido/presencial va en `modalidad` y bloqueadores, no en `location_ok`".

**b. `action_acc` 64 %** (v1.2 × 3.5-flash). Matriz humano → modelo:

| humano  modelo | aplicar | guardar | descartar |
|---|---|---|---|
| aplicar (5) | 5 | 0 | 0 |
| guardar (6) | **3** | 1 | **2** |
| descartar (3) | 0 | 0 | 3 |

Los 5 errores son "guardar" humano. Tres son guardar → aplicar (Empresa F 7, Empresa S 24, Empresa Z 32): el modelo puso 7,5 en los tres, justo sobre el umbral de aplicar (7). Pero no es solo umbral: en Empresa F y Empresa S el score humano es 6,5 y 5,5 (el modelo infla el match 1–2 puntos), y en Empresa Z el humano puso 8 pero guardó por `location_ok = no`, que `decide()` hoy trata como un riesgo más ("riesgos + score ≥ 7 → aplicar"). Subir el umbral a 8 arreglaría estos tres pero rompería Empresa AB 34 (7,5, aplicar). Los otros dos son guardar → descartar por bloqueador (Empresa A 1: 8+ años; Empresa L 13: título Lead de la blocklist), y ahí el golden es inconsistente consigo mismo: Empresa A tiene anotado el bloqueador de años Y acción guardar. Lectura: una parte se arregla en `decide()` (`location_ok = no` → tope guardar), otra en el golden (bloqueador anotado ⇒ descartar, o quitar el bloqueador), y el resto es inflación del score que es del prompt.

### Segunda tanda (2026-09-11, golden corregido: Empresa O 16 → ok, Empresa A 1 → descartar; `decide()` con tope guardar si `location_ok = no`)

Prompt v1.3 = v1.2 + (a) disciplina como paso explícito antes de puntuar, (b) la modalidad no afecta `location_ok`, (c) ancla de calibración contra la inflación del score. 42 llamadas, USD 0,216.

| Métrica | v1.2 × 3.5 | v1.3 × 3.5 | v1.3 × lite |
|---|---|---|---|
| score_mae (ancla) | **1,07** | 1,50 | 1,21 |
| blockers_recall | 100 % | 100 % | **100 %** (Empresa J detectado) |
| blockers_precision | 80 % | 80 % | **50 %** |
| risks_recall | 100 % | 100 % | 100 % |
| action_acc | 71 % | **79 %** | 71 % |
| false_apply | 0 | 0 | 0 |
| location_risk_recall | **100 %** | **100 %** | **100 %** |
| JSON inválidos | 0 | 0 | 0 |
| USD corrida | 0,096 | 0,103 | 0,017 |

- Las correcciones del golden y el tope de `decide()` solos (v1.2 × 3.5) llevaron location_risk_recall de 50 % a 100 % y action_acc de 64 % a 71 %.
- **v1.3 con 3.5-flash** mejora la acción (79 %) pero empeora el MAE a 1,50: el paso de disciplina hace que Empresa J bloquee bien pero puntúe 8,5 de "encaje técnico" (ancla humana 3: Mauro pliega la disciplina en el score de match) y Empresa L sube a 7,5; el ancla de calibración bajó Empresa AB (7 → 6,5, aplicar → guardar). Punto de definición a decidir: si la disciplina distinta debe además bajar el score (como en el golden) o solo bloquear (como dice v1.3).
- **v1.3 con flash-lite** cumple los cuatro criterios del paso D (MAE +0,14 contra v1.2 × 3.5, blockers_recall 100 %, risks 100 %, 0 JSON inválidos): el paso de disciplina arregló Empresa J. Pero blockers_precision cae a 50 %: inventa bloqueadores fuera de la lista (Empresa F 6 y 7: "5/6 años requeridos" cuando la regla es ≥ 8; Empresa Z: inglés avanzado y país no listado, que son riesgos) y descarta 4 ofertas que el humano guardaría. No se cambió `model_routing`: decisión de Mauro con estos números. Si se quiere insistir con flash-lite, el siguiente ajuste es cerrar la lista de bloqueadores en el prompt ("años requeridos ≥ 8; 5–7 NO es bloqueador") y volver a medir.

### Cierre de la calibración (2026-09-11, tercera tanda: prompt v1.3.1)

v1.3.1 = v1.3 + disciplina distinta bloquea Y topea el score en 3, con la explicación de por qué modalidad y disciplina se tratan distinto (ADR-011) + lista cerrada de bloqueadores (5–7 años, idioma y país NO son bloqueadores). 28 llamadas, USD 0,124. Dos arreglos de medición en la misma tanda: el harness parseaba "v1.3.1" como v1 y medía contra el ancla equivocada (`promptVersionNumber` ahora lee mayor.menor); el harness no aplicaba el tope de `location_ok = no` que sí aplica `decide()` (ahora comparten `applyLocationCap`); y `location_risk_recall` no contaba la ubicación humana "no" en el denominador. Todos los reportes del día están recalculados con esas tres correcciones; por eso las cifras de abajo difieren de las tablas anteriores.

| Corrida (golden corregido, tope de ubicación) | MAE | blockers_recall | blockers_precision | risks_recall | action_acc | false_apply | location_risk_recall | USD |
|---|---|---|---|---|---|---|---|---|
| v1.2 × 3.5-flash | 1,07 | 100 % | 80 % | 100 % | 79 % | 0 | 100 % | 0,096 |
| v1.3 × 3.5-flash | 1,50 | 100 % | 80 % | 100 % | 86 % | 0 | 100 % | 0,103 |
| v1.3 × flash-lite | 1,21 | 100 % | 50 % | 100 % | 71 % | 0 | 100 % | 0,017 |
| **v1.3.1 × 3.5-flash** | **0,96** | 100 % | 80 % | 100 % | 79 % | 0 | 100 % | 0,106 |
| **v1.3.1 × flash-lite** | **1,00** | 100 % | 80 % | 100 % | **86 %** | 0 | 50 % | 0,018 |

Errores restantes de v1.3.1 (los mismos en los dos modelos): Empresa F 7 (guardar → aplicar, score 7–7,5 contra 6,5 humano), Empresa L 13 (guardar → descartar por el título Lead de la blocklist, que el golden mantiene en guardar), y con 3.5-flash Empresa AB 34 (aplicar → guardar, 6,5). El 80 % de precisión de bloqueadores es solo Empresa L. La ubicación de flash-lite en 50 % es Empresa AB ("LATAM" sin países → el modelo dijo ok; Empresa Z, el caso "no", lo detectó y el tope lo llevó a guardar).

**Decisiones aplicadas según las reglas que fijó Mauro antes de la corrida:**
- Prompt de producción: **v1.3.1** (MAE vuelve a ≤ 1,07 manteniendo action_acc 79 % con 3.5-flash).
- **flash-lite pasa a primario de `evaluate_job`, 3.5-flash de fallback** (cumple MAE +0,04, blockers_recall 100 %, risks 100 %, 0 JSON inválidos, y el techo de precisión 80 %). Costo: **USD 0,0013 por evaluación**, USD 0,77 al mes a 20 por día; el fallback cuesta 6 veces más.
- Residual a vigilar con ofertas reales: flash-lite no marca riesgo en "LATAM sin países" (Empresa AB). El prefiltro determinista ya agrega el flag `location_risk` cuando el aviso no lista países, así que en producción el riesgo entra por `decide()` igual.

**Fin de la calibración.** Lo que falta se calibra con ofertas reales entrando (JS-036), no con las 34 del golden. Gasto total de la calibración del día: USD 0,60.

### Métricas endurecidas (2026-09-11, tarde): qué cambia en los números

El harness medía con indulgencia: bloqueadores y riesgos por presencia ("algún bloqueador"), ubicación con riesgo ≡ no, y una acción que no era la de producción (`decideAction` sin cap de título, sin bloqueador por años ≥ 8, sin penalizaciones ni riesgos del prefiltro). Ahora: bloqueadores y riesgos por TIPO (taxonomía cerrada; "salario no publicado" excluido del recall), ubicación exacta, y la acción sale del prefiltro + `decide()` completos. Los reportes guardan la salida cruda (`model_raw`) y `pnpm evals recompute` re-mide sin llamar a la API. Los reportes de hoy son anteriores a `model_raw`: el recálculo no pudo reproducir el bloqueador por años ni las penalizaciones de años e inglés (lo anota), así que la acción de producción está aproximada por lo bajo.

| Corrida | MAE | blockers_recall (tipo) | blockers_precision (tipo) | risks_recall (tipo, sin salario) | action_acc (producción) | location (exacta) |
|---|---|---|---|---|---|---|
| v1.2 × 3.5-flash | 1,07 | 100 % (=) | 80 % (=) | 100 % (=) | 79 % (=) | 100 % (=) |
| v1.3.1 × 3.5-flash | 0,96 | 100 % (=) | 80 % (=) | 100 % (=) | 79 % (=) | 100 % (=) |
| v1.3.1 × flash-lite | 1,00 | 100 % (=) | 80 % (=) | **89 %** (era 100) | **79 %** (era 86) | 50 % (=) |

Lectura: los bloqueadores que el modelo devolvió eran del tipo correcto (Empresa J y Empresa K por disciplina, Empresa A por años, Empresa M por modalidad); la indulgencia no escondía un error ahí. Lo que cambia para flash-lite: (1) un riesgo de tipo distinto en Empresa AA 33 (humano "empresa de staffing", modelo "empresa desconocida") baja risks_recall a 8 de 9, justo bajo el 90 % del criterio; (2) con `decide()` completo, Empresa AB 34 pasa a guardar en TODAS las corridas (la penalización por gap must de cloud baja el score de 7 a 6, y con el flag `location_risk` del prefiltro queda en guardar): eso no es del modelo, es la regla de producción contra la anotación humana "aplicar", y afecta igual a 3.5-flash. **Criterio del paso D con métricas duras: flash-lite falla risks_recall por un riesgo (89 % vs 90 %) y ubicación exacta (50 %, Empresa AB LATAM → ok). Decisión de Mauro si sigue en producción.** 3.5-flash con v1.3.1 cumple todo salvo action_acc ≥ 85 % (79 %), igual que antes.

### Decisión final de modelo (2026-09-11, noche): 3.5-flash vuelve a primario

**flash-lite sale de producción de `evaluate_job`; primario `gemini-3.5-flash` con `minimal` y prompt v1.3.1, fallback `claude-haiku-4-5`.** Razón (Mauro): el fallo de ubicación exacta (LATAM sin países → "ok") es exactamente el error que costó dos postulaciones reales; ahorrar USD 3,30 al mes no lo compensa y USD 4,08 entra en la métrica del PRD. flash-lite queda anotado como **candidato para `extract_skills`**, una tarea más simple (extraer términos, sin juicio de ubicación ni disciplina), a medir cuando esa tarea se implemente.

**Pregunta abierta (Empresa AB, golden 34):** con `decide()` completo la penalización por gap must de cloud lleva el score de 7 a 6 y la acción a "guardar", cuando el humano postuló. La regla de producción es más conservadora que el criterio humano. Candidato a recalibrar con ofertas reales y outcomes (JS-036): ¿`cloud_must_penalty` debería ser −0,5 en vez de −1? No se toca hasta tener datos.

## Cómo ver el consumo por proyecto en Google

Las API keys son credenciales de un proyecto de Google Cloud: heredan su facturación y su cuota, y el consumo se ve por proyecto, no por key.

- AI Studio → [Dashboard › Usage](https://aistudio.google.com/usage): consumo por proyecto y por modelo, con el selector de proyecto arriba.
- AI Studio → [Billing](https://aistudio.google.com/billing): saldo prepago ("Available credits"); al llegar a 0 dejan de funcionar todas las keys de todos los proyectos ligados a esa cuenta de facturación.
- Cloud Console → [Billing › Reports](https://console.cloud.google.com/billing/reports): filtrar por servicio "Gemini API" y agrupar por proyecto; los SKUs separan entrada y salida por modelo. Hasta 24 h de retraso.
- Cloud Console → APIs & Services › Generative Language API › Metrics: requests por proyecto en el tiempo (sirve para ver un cron con reintentos).
- Límites activos por proyecto: [AI Studio › Rate limits](https://aistudio.google.com/rate-limit).
