# ADR-025: Claude Haiku 5.5 para las tareas de volumen: evaluado y no adoptado por ahora

**Status:** Proposed · **Date:** 2026-10-26

## Context
Las tareas de volumen (`evaluate_job`, `extract_skills`, `parse_email_fallback`) corren con Gemini.
El proyecto tiene créditos de la API de Anthropic disponibles, y la API comercial de Anthropic no
entrena con el contenido por defecto. Claude Haiku 5.5
cuesta 0,10 / 0,50 USD por MTok, alrededor de un décimo de Gemini Flash por evaluación. Se evaluó
pasarlo a modelo principal, con Gemini de respaldo.

## Evaluación (golden de evaluate_job, prompt vigente, sin cambiar el prompt)
| | Gemini 3.5 Flash (línea de base) | Haiku 5.5, sin thinking | Haiku 5.5, thinking bajo |
|---|---|---|---|
| Acuerdo en la acción | ≈ 81 % | ≈ 65 % | ≈ 72 % |
| Acuerdo en la disciplina | ≈ 97 % | ≈ 73 % | ≈ 83 % |
| Error del puntaje (MAE) | ≈ 1,0 | ≈ 1,2 | ≈ 1,2 |
| Descartes que no correspondían | pocos | muchos más | más |
| Salida estructurada inválida en el primer intento | 0 | algunas por corrida | más de un tercio |
| Riesgo de ubicación detectado (estricto) | ≈ 38 % | ≈ 63 % | — |

El criterio de pase era: acuerdo en la acción de al menos la línea de base menos 3 puntos, cero
errores de salida estructurada y sin regresión en ubicación ni idioma. Ninguna variante lo cumple.

## Decision
1. **El ruteo no cambia:** Gemini sigue como principal de las tres tareas. Haiku no se adopta con el
   prompt actual.
2. **El camino Anthropic queda más robusto**, porque igual es el respaldo y lo usan las tareas de
   redacción:
   - el intento al primario sin clave queda en `llm_calls` como `provider_unavailable`;
   - el crédito agotado (400 «credit balance is too low» o `billing_error`) se guarda como `api_call:402`;
   - un `stop_reason: "refusal"` se guarda como `refusal` y cae al respaldo.
3. **Cualquier error del primario cae al respaldo, incluido un 400 de validación.** Se evaluó la
   alternativa y se descartó: un error de parámetros no debería cortar el servicio. Queda visible como
   `api_call:400`.

## Alternativas consideradas
- **Haiku 5.5 como principal:** no pasa la evaluación (arriba).
- **Haiku 4.5:** diez veces más caro que Haiku 5.5 y de la generación anterior. No se midió.
- **Sonnet 5.5 en `evaluate_job`:** sin medir. Cuesta alrededor del doble que Gemini Flash por evaluación.
- **Ajustar el prompt para Haiku:** posible. Requiere una versión nueva del prompt y evals pagos.

## Consequences
- El costo por evaluación no baja por ahora.
- Las tareas con Sonnet siguen sin usar Anthropic en producción mientras no esté la clave. Antes de
  cargarla, hay que revisar `max_tokens` y el thinking de esas filas: Sonnet 5.5 piensa por defecto y
  rechaza `thinking: disabled`.
- Haiku 5.5 bloquea más por requisito de idioma que la línea de base. El golden no tiene casos de
  ese tipo con evaluación humana, así que la comparación de idioma queda inconclusa.

## Cuándo revisarlo
- Con una versión nueva del prompt de `evaluate_job`: medir Haiku 5.5 de nuevo, con el mismo criterio.
- Si cambian los precios o los créditos disponibles, o si sale un modelo chico nuevo.
