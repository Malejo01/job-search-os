# PRD — Job Search OS

**Versión:** 1.0 · **Fecha:** 2026-09-09 · **Owner:** Mauro Lizárraga

## 1. Problema

Buscar trabajo remoto en IA/desarrollo consume 1–2 horas diarias de trabajo repetitivo: abrir alertas, descartar ruido (75% de duplicación entre alertas de LinkedIn; fuentes enteras con 0% de relevancia), leer JDs largas para descubrir un bloqueador en la última línea, y no tener registro de qué pide el mercado en conjunto. Las herramientas existentes (AIApply, LoopCV, JobCopilot) resuelven el problema opuesto — aplicar en volumen — y generan quejas por calidad y precios opacos.

## 2. Usuario

**Fase 1:** Mauro (uso propio). Perfil AI Engineer / Fullstack en Argentina, solo remoto. El repo público trae un perfil y un dataset de ejemplo; el perfil real vive en `fixtures-private/`.
**Fase 2+:** desarrolladores IT en LATAM que buscan remoto internacional y quieren pocas postulaciones bien elegidas más un plan de formación basado en su mercado real.

## 3. Tesis de producto

1. **Menos y mejor.** 5 JDs leídas por día, no 50. El sistema filtra el 90% sin abrir LinkedIn.
2. **Explicabilidad.** Cada score viene con `match_fuerte`, `gaps`, `bloqueadores_duros`. Nada de "87% match" sin razones.
3. **Perfil verificable.** El nivel por skill sale de evidencia (repos, certificaciones, proyectos, respuestas a preguntas dirigidas), no de autodeclaración.
4. **El mercado decide qué estudiar.** Agenda de mercado agregada → plan de formación priorizado por demanda ponderada × gap × facilidad de cierre.
5. **Feedback loop.** El resultado real de cada postulación recalibra el evaluador.

## 4. Alcance

### Fase 1 — Core (finde 11–13 sep + 2 semanas)
- Ingesta: Get on Board (API pública), email forwarding (LinkedIn y otros), carga manual de JD.
- Dedup + prefiltro determinista.
- Evaluación LLM con JSON estructurado.
- Cola "pendiente de JD" con flujo Claude in Chrome manual.
- UI: lista, filtro por score/fuente/estado, cambio de estado, pegar JD.
- Tracking de postulaciones y resultados.
- Multi-tenant en schema y auth (Supabase Auth + RLS), sin onboarding público.
- Tests unitarios + evals en CI.

### Fase 2 — Inteligencia (semanas 3–6)
- Taxonomía de skills y extracción normalizada.
- Agenda de mercado con series temporales.
- Perfil verificable (CV + LinkedIn PDF + portfolio + GitHub → entrevista dirigida → niveles 0–3).
- Gap analysis + plan de formación + catálogo de recursos.
- Servidor MCP propio para operar desde Claude.

### Fase 3 — Plataforma (después)
- Migración a AWS (SST), Docker en CI, observabilidad completa.
- Onboarding para terceros, BYOK, planes.
- Recruiter CRM, interview prep, Application Kit RAG.

## 5. No-alcance (explícito)
- **Auto-apply.** Nunca. Ni en LinkedIn ni en ningún portal.
- **Scraping de LinkedIn** en cualquier forma. La cuenta es el activo.
- Gmail OAuth para terceros (ver ADR-003).
- Generación de CVs "optimizados para ATS" como feature central.
- Fine-tuning de modelos.

## 6. Métricas de éxito

| Métrica | Objetivo fase 1 |
|---|---|
| Tiempo humano diario | ≤ 45 min |
| Ofertas abiertas manualmente por día | ≤ 5 |
| Duplicados que llegan a evaluación | < 5% |
| MAE del score vs. referencia humana | ≤ 1.0 |
| Bloqueadores duros detectados | 100% del golden set |
| Costo LLM mensual (uso propio) | < USD 5 (medido 2026-09-11: USD 0,0068 por evaluación con gemini-3.5-flash `minimal` y prompt v1.3.1 → USD 4,08 a 20 ofertas/día) |
| Tasa de respuesta a postulaciones score ≥ 7 | medir; baseline actual desconocido |

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| El proyecto reemplaza la búsqueda | Techo: 8 hs/semana después del finde; si en 4 semanas no evalúa ofertas reales, se congela lo no-core |
| Gemini 2.5 Flash se apaga (16-oct-2026) | Ruteo por tabla + evals de regresión; migrar a gemini-3.5-flash en JS-014 |
| Cambio de formato en emails de LinkedIn | Parser con fixtures y test de regresión; fallo → cola manual, no pérdida |
| Rechazo automático por ubicación | Campo `location_ok: "riesgo"` cuando "LATAM" sin países; UI lo muestra antes de aplicar |
| Datos personales de terceros (CV, respuestas) | Storage privado por usuario, RLS, borrado a pedido, sin cross-user training |

## 8. Aprendizajes del dataset semilla (34 ofertas, 7–9 sep 2026; empresas anonimizadas como Empresa A…AB en el repo público)

- Las mejores ofertas (7–8) piden 3–4 años, no exigen cloud enterprise y valoran rigor sobre sistemas no determinísticos. Son startups/producto, no consultoras.
- Consultoras grandes (Empresa L, Empresa J, Empresa A, Empresa N): 7–10 años.
- Mercado local argentino: IA como capa sobre stack senior tradicional (.NET/Angular/Java). Internacional: la IA sola alcanza.
- Dos rechazos automáticos por ubicación en "LATAM remoto" sin países explícitos (Empresa AB, Empresa O).
- Ofertas de IA en Argentina remoto se cierran en 24 hs. Alertas semanales llegan vencidas.
- 4 alertas de LinkedIn → 12 avisos, 3 únicos.
- Búsqueda directa con filtros "24 hs + remoto + <10 solicitantes": 27 resultados donde la alerta mostraba 3.
- Get on Board: las dos mejores ofertas locales, con salario publicado.
- Portales de carrera de dos empresas grandes e Indeed: 0/8 aplicables. Desactivadas.
- Badge "X de Y aptitudes coinciden": 3/4 → analizar; 1/10 → descartar.
- Excepción a la regla "Lead → descartar": Empresa L Lead AI Engineer con 2 candidatos y match agéntico alto se puntuó 5 y se aplicó. Regla ajustada: Lead/Manager cap 5 si ≤ 5 candidatos y disciplina ai_engineer; cap 3 en el resto.
- Misma empresa, distinto rol (Empresa F ×2) NO es duplicado. Duplicado = misma empresa + título similar, o texto compartido > 90%.
