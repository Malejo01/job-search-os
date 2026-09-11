# Evaluador de ofertas — prompt v1

Archivo ejecutable: [`packages/prompts/evaluate_job.v1.md`](../packages/prompts/evaluate_job.v1.md). Este doc explica el diseño; el prompt se carga desde el archivo con `prompt_version = "evaluate_job@v1"`.

## 1. Principio de diseño

El LLM **describe** la oferta contra el perfil y **propone** un score. El código:
- aplica los bloqueadores duros deterministas (prefiltro) antes de llamar al modelo;
- recalcula `accion` desde `score` + `bloqueadores_duros` + `thresholds`;
- aplica el `cap` de título y las penalizaciones numéricas que se pueden verificar con campos estructurados (años, cloud must, inglés fluent), corrigiendo el score del modelo si no las aplicó.

Así el score final es reproducible aunque el modelo varíe.

## 2. Entradas del prompt

| Variable | Origen |
|---|---|
| `{{profile_summary}}` | `profiles.profile_summary` (generado desde `skill_levels`, proyectos, certificaciones) |
| `{{constraints}}` | ubicación, `remote_only`, `work_auth`, `salary_floor_usd`, `max_weekly_hours`, `english_cefr` |
| `{{criteria}}` | `CriteriaRules` renderizadas en texto |
| `{{job}}` | título, empresa, ubicación, modalidad, salario, badges, candidatos, fecha, `jd_text` (o "JD NO DISPONIBLE") |
| `{{had_full_jd}}` | true/false — si false, el modelo evalúa con lo que hay y marca `confianza: "baja"` |

## 3. Reglas deterministas (viven en código, se repiten en el prompt para coherencia)

**Descarte / cap (score ≤ 3):** título en blocklist (salvo allowlist) · ≥ 8 años · keywords de ML Engineer o AI eval como requisito central · otra disciplina · presencial/híbrido · autorización US/EU exigida · salario < piso o > horas máximas.
**Excepción calibrada:** título blocklist + ≤ 5 candidatos + disciplina `ai_engineer` → cap 5 (caso Empresa L).
**Penalizaciones:** 5–7 años → −2 (salvo match agéntico alto: −1) · cloud must-have → −1 · inglés fluent/excellent/highest → −1 · "LATAM remoto" sin países → `location_ok = "riesgo"` (no resta, se muestra).
**Señales positivas:** 3–4 años · RAG/agentes/MCP/tool calling/HITL/guardrails · "evaluar sistemas no determinísticos" · herramientas de IA para desarrollar como requisito · client-facing · badges "En busca de personal"/"Crecimiento rápido" · aptitudes ≥ 60% · publicada < 24 hs con pocos candidatos · "no piden años".

**Umbrales:** 9–10 `aplicar_personalizado` · 7–8.9 `aplicar` · 5–6.9 `guardar` (en la práctica: aplicar salvo bloqueador) · < 5 `descartar`.

## 4. Salida (Zod)

```ts
export const EvaluationSchema = z.object({
  score: z.number().min(0).max(10),
  confianza: z.enum(["alta", "media", "baja"]),
  years_required: z.number().int().nullable(),
  location_ok: z.enum(["ok", "riesgo", "no"]),
  modalidad: z.enum(["remoto", "hibrido", "presencial", "desconocida"]),
  disciplina: z.enum([...]),                 // ver schema.ts
  ingles_requerido: z.enum(["no_menciona", "no", "basico", "intermedio", "avanzado", "nativo"]),
  tipo_empresa: z.enum(["producto", "startup", "consultora", "staffing", "agencia", "desconocido"]),
  paises_permitidos: z.array(z.string()).nullable(),
  match_fuerte: z.array(z.string()).max(8),
  gaps: z.array(z.string()).max(8),
  bloqueadores_duros: z.array(z.string()),
  senales_positivas: z.array(z.string()),
  veredicto: z.string().max(200),
  accion_sugerida: z.enum(["aplicar_personalizado", "aplicar", "guardar", "descartar"]),
});
```

## 5. Calibración esperada (golden set, 34 ofertas)

| Métrica | Umbral para aceptar el prompt/modelo |
|---|---|
| MAE de `score` vs `human_score` (ofertas con score humano) | ≤ 1.0 |
| Recall de `bloqueadores_duros` humanos | 100% (al menos un bloqueador equivalente por oferta bloqueada) |
| Concordancia de `disciplina` | ≥ 90% |
| Concordancia de `accion` (tras recalcular en código) | ≥ 85% |
| Falsos "aplicar" en ofertas humanas ≤ 4 | 0 |

## 6. Ofertas clave para calibrar (anclas)

| id | Score humano | Por qué es ancla |
|---|---|---|
| 33 Empresa AA | 8 | Match total sin stack pesado; inglés hablado como único gap |
| 28 Empresa V | 7.5 | "Agent Architect" es rol técnico (allowlist); tesis > stack |
| 16 Empresa O | 7 | Perfecto en papel; rechazo por ubicación → `location_ok: riesgo` |
| 30 Empresa X | 7 | Trazabilidad de agentes; gap de dominio (growth), no de stack |
| 34 Empresa AB | 7 | Snowflake must-have como gap real; ubicación riesgo |
| 7 / 6 Empresa F | 6.5 / 6 | Mismo empleador, roles distintos; años 5–6 penalizan |
| 32 Empresa Z | 6 | Match de tesis alto; Argentina fuera de países → riesgo |
| 13 Empresa L | 5 | Lead con 2 candidatos: excepción al cap |
| 24 Empresa S | 5.5 | .NET must + Azure; herramientas IA must |
| 14 Empresa M | 4.5 | "Cumplo la IA, fallo la infraestructura" |
| 12 Empresa K | 2 | Frontera ML Engineer |
| 11 Empresa J | 3 | Frontera AI eval |
| 19 / 20 Empresa Q | 2.5 | Salario bajo + duplicado |
| 17 Empresa N Mgr | 1 | Manager + 10 años + ML |
