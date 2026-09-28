# Modelo de datos

Fuente de verdad: [`packages/db/schema.ts`](../packages/db/schema.ts) (Drizzle). Este doc explica las decisiones; el código define los tipos.

## Mapa

```
profiles ─1:N─ evaluation_criteria (versionado, JSONB rules)
profiles ─1:N─ jobs ─1:N─ job_sources        (una oferta, muchas fuentes: dedup fusiona acá)
                jobs ─1:N─ evaluations        (re-evaluar crea otra fila; la última vigente por created_at)
                jobs ─1:1─ applications ─── outcome (feedback loop)
                jobs ─N:M─ skills (job_skills, is_must)      ← fase 2
companies ─1:N─ jobs · contacts
skills ─1:N─ skill_levels · skill_evidence · skill_interviews · learning_resources
market_snapshots (user, semana, skill) ← agregación semanal de job_skills × evaluations.score
learning_plan_items (user, skill, resource, priority)
model_routing · llm_calls · inbound_emails · talent_platforms
profiles ─1:N─ candidate_facts · 1:1 application_settings · 1:N answer_bank   (JS-053)
                jobs ─1:N─ application_answers (formulario respondido, se reemplaza entero)
```

## Decisiones

- **`jobs.userId` y no un catálogo global de ofertas.** Cada usuario ve las ofertas que sus fuentes le traen. Un catálogo compartido es una optimización de fase 3 (misma `canonical_url` → compartir `jd_text`), no un requisito hoy.
- **`evaluations` es append-only.** Cambiar prompt, modelo o criterios genera una evaluación nueva con `prompt_version`, `criteria_version`, `model`. Así se compara.
- **`evaluations.accion` la calcula código** desde `score`, `bloqueadores_duros` y `thresholds`; el LLM sugiere pero no decide.
- **`human_score`** en `evaluations` es el ancla de calibración. El golden set entra como evaluaciones con `model = 'human'`.
- **`jobs.status`** es la máquina de estados; las transiciones válidas viven en `packages/pipeline/status.ts`, no en la UI.
- **`skills` global + `skill_levels` por usuario.** La taxonomía es compartida; el nivel, la evidencia y la entrevista son del usuario.
- **`market_snapshots` por usuario.** La "agenda de mercado" refleja lo que ese usuario ve; agregados cross-usuario solo anónimos y en fase 3.
- **`evaluation_criteria.rules` JSONB con tipo `CriteriaRules`.** Editable sin migración; validado con Zod al leer.
- **Contexto de postulaciones (JS-053).** `candidate_facts` es lo único que se puede afirmar en un formulario: cada hecho lleva fuente obligatoria y `verificable | autodeclarado`, y se desactiva en vez de borrarse. `application_settings` no repite datos de `profiles` (piso, ubicación, inglés): una sola fuente para el evaluador y los formularios. `answer_bank` es único por (usuario, pregunta normalizada, idioma): guardar de nuevo reemplaza.

## Máquina de estados de `jobs.status`

```
nueva → prefiltrada → pendiente_jd → evaluada → aplicada → {rechazada | entrevista → oferta}
   │         │                          │
   └─► descartada_prefiltro             └─► descartada
aplicada → rechazo_automatico (ubicación u otro; se registra en applications.outcome)
cualquiera → cerrada (la oferta ya no acepta postulaciones)
```

## RLS (resumen)

```sql
alter table jobs enable row level security;
create policy jobs_owner on jobs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Igual para: evaluation_criteria, job_sources (via join), evaluations, applications, contacts,
-- talent_platforms, skill_levels, skill_evidence, skill_interviews, market_snapshots,
-- learning_plan_items, llm_calls, inbound_emails, candidate_facts, application_settings.
-- answer_bank y application_answers: además, la oferta referenciada tiene que ser del usuario
-- (la FK se chequea como dueño de la tabla y no pasa por RLS).
-- skills, learning_resources, model_routing, companies: select para authenticated; escritura solo service_role.
```

## Seeds

- `seeds/skills.json`: taxonomía inicial (~60 skills) con aliases y `closure_hours`. Ver `packages/db/seeds/skills.json`.
- `seeds/model_routing.json`: ruteo inicial.
- `seeds/criteria.mauro.json`: `CriteriaRules` v1 calibradas con el golden set.
- `evals/fixtures/golden.json`: 34 ofertas → se cargan como `jobs` + `evaluations(model='human')`.
- `seeds/applicant.example.json`: hechos y respuestas fijas de ejemplo (JS-053). Los reales van en `fixtures-private/applicant.json` y se cargan con `pnpm applicant:sync` (no con `db:seed`).
