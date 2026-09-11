# ADR-005: Ruteo de modelos por tabla y migración fuera de Gemini 2.5 Flash

**Status:** Accepted · **Date:** 2026-09-09

## Context
`gemini-2.5-flash` y `gemini-2.5-flash-lite` tienen shutdown el 16-oct-2026. Google recomienda `gemini-3.5-flash` y `gemini-3.1-flash-lite`. Google ha apagado modelos antes de la fecha publicada. Los mismos modelos se usan en Qué Pinta Salta, Tuki y MaestrIA.

## Decision
- Abstracción con Vercel AI SDK (`generateObject` + Zod).
- Tabla `model_routing` por tarea: `evaluate_job`, `extract_skills`, `dedup_semantic`, `judge_calibration`, `recruiter_message`.
- Primario por defecto: `gemini-3.5-flash`. Volumen bajo riesgo: `gemini-3.1-flash-lite`. Juez y tareas de alto valor: Claude Sonnet 5. Fallback de extracción: Claude Haiku 4.5.
- Ningún modelo `-preview` en producción.
- Cambio de modelo requiere evals verdes sobre el golden set (MAE ≤ 1.0, bloqueadores 100%).

## Options Considered
- **A: Hardcodear gemini-3.5-flash.** Simple; la próxima deprecación repite el problema.
- **B: Tabla de ruteo + evals (elegida).** Cambio sin deploy; regresión medida.
- **C: LiteLLM/OpenRouter como proxy.** Añade infraestructura; útil en fase 3 si hay BYOK multi-provider.

## Consequences
- El harness de evals se convierte en herramienta reutilizable para migrar los otros proyectos.
- Embeddings: verificar dimensión del modelo de embeddings vigente antes de migrar corpus con pgvector.
