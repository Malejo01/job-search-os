# Modelo de datos

Fuente de verdad: [`packages/db/schema.ts`](../packages/db/schema.ts) (Drizzle). Este doc explica las decisiones; el código define los tipos.

## Mapa

```
profiles ─1:N─ evaluation_criteria (versionado, JSONB rules)
profiles ─1:N─ jobs ─1:N─ job_sources        (una oferta, muchas fuentes: dedup fusiona acá)
                jobs ─1:N─ evaluations        (re-evaluar crea otra fila; la última vigente por created_at)
                jobs ─1:1─ applications ─── outcome (feedback loop)
                jobs ─N:M─ skills (job_skills, is_must)      ← fase 2
companies ─1:N─ jobs · contacts · public_jobs
public_jobs ─1:N─ public_job_skills            (pool global, sin user_id; ADR-014)
public_jobs ─1:N─ jobs                         (jobs.public_job_id: la copia por usuario)
public_jobs ─1:N─ public_jobs                  (dedup_of_id: copia de otra fila del pool, sin fusión)
public_job_fetches                             (bitácora global de descargas por fuente)
ats_boards (provider, token)                   (boards públicos de ATS que descarga el pool; global, ronda 47)
role_market_snapshots (rol, semana, skill)     (agregados de demanda por rol, global)
skills ─1:N─ skill_levels · skill_evidence · skill_interviews · learning_resources
market_snapshots (user, semana, skill) ← agregación semanal de job_skills × evaluations.score
learning_plan_items (user, skill, resource, priority)
model_routing · llm_calls · inbound_emails · talent_platforms
profiles ─1:N─ candidate_facts · 1:1 application_settings · 1:N answer_bank   (JS-053)
                jobs ─1:N─ application_answers (formulario respondido, se reemplaza entero)
```

## Decisiones

- **Pool global de ofertas públicas (ADR-014) más copias por usuario en `jobs`.** `public_jobs` guarda ofertas de fuentes públicas (Get on Board, Remote OK, Jobicy, Himalayas, We Work Remotely y los ATS públicos) sin `user_id`: nada por persona va ahí. Todo lo que es de la persona sigue en `jobs` (estado, flags, prefiltro, evaluaciones, postulación). `jobs.public_job_id` apunta a la oferta del pool de la que salió la copia (`ON DELETE SET NULL`: purgar el pool no toca la copia). Reemplaza la decisión anterior de "`jobs.userId` y no un catálogo global" y la optimización de fase 3 que preveía.
- **Fuentes del pool y `ats_boards` (ronda 47, migración 0024).** El enum `source_kind` suma `wwr`, `greenhouse`, `lever` y `ashby` (solo `ADD VALUE`: no se revierte). `ats_boards` lista los boards de los ATS públicos que descarga el pool: `provider` (check: `greenhouse`, `lever`, `ashby`), `token` (slug del board), `region` (solo Lever: `eu`), `company_name`, `enabled`, `notes`, `last_fetch_at`, `last_status` (código cerrado, nunca un mensaje crudo) y `created_at`; único por `(provider, token)`. Es global y sin datos de personas: RLS activo y sin policy (`rls/0005_ats_boards.sql`), así que la app no la lee ni la escribe; la usa el cron con la conexión de servicio. Arranca vacía; el seed lo arma y lo corre Mauro.
- **El pool no fusiona.** Una oferta que llega por otra fuente con la misma URL o el mismo texto se inserta igual y apunta a la raíz con `public_jobs.dedup_of_id`; ningún texto se pierde. Retención: 30 días desde `last_seen_at`, con emails y teléfonos quitados de título, empresa, ubicación, JD y crudo al guardar.
- **`profiles.target_role` y `profiles.pool_daily_eval_limit`.** El rol objetivo se valida en código contra `ROLE_KEYS` (sin enum en la base: agregar un rol no pide migración). El tope diario de evaluaciones del pool es `null` mientras rija el default de la variable de entorno.
- **Varios puestos (ADR-016).** `profiles.target_roles text[] NOT NULL DEFAULT '{}'` guarda los puestos elegidos, validados en código contra `ROLE_KEYS`; el primero es el principal. `profiles.target_role` se queda como ese principal y se escribe siempre junto con la lista (migración 0021: backfill `ARRAY[target_role]`). `profiles.max_target_roles integer` (null = rige `TARGET_ROLES_FREE_LIMIT`) pisa el tope por persona. `jobs.matched_role text` (null) guarda el puesto por el que se asignó una oferta del pool; la ronda 43 se lo pasa al evaluador.
- **`evaluations` es append-only.** Cambiar prompt, modelo o criterios genera una evaluación nueva con `prompt_version`, `criteria_version`, `model`. Así se compara.
- **`evaluations.accion` la calcula código** desde `score`, `bloqueadores_duros` y `thresholds`; el LLM sugiere pero no decide.
- **`human_score`** en `evaluations` es el ancla de calibración. El golden set entra como evaluaciones con `model = 'human'`.
- **`human_verdict`** (`de_acuerdo` / `en_desacuerdo`, nulable) y `human_verdict_at` en `evaluations`: veredicto de un toque. `NULL` = sin opinión. No es un score: queda fuera del MAE y del snapshot de mercado; el motivo opcional va en `human_note`.
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
-- Pool (rls/0004_public_jobs.sql): public_jobs, public_job_skills, role_market_snapshots tienen
-- ENABLE sin FORCE y una policy de solo lectura (using true), sin policies de escritura: escribe
-- solo el servicio con la conexión dueña. public_job_fetches tiene ENABLE y ninguna policy: la
-- app no la lee ni la escribe. Lo mismo ats_boards (rls/0005_ats_boards.sql).
```

## Seeds

- `seeds/skills.json`: taxonomía de skills con aliases y `closure_hours`: tecnología más carreras digitales (ronda 40, ADR-015). Ver `packages/db/seeds/skills.json`.
- Migración `0019` (ronda 40): es de datos, sin cambios de esquema. Suma 19 skills de carreras digitales (marketing, producto, RRHH IT y customer success) y hace de `hubspot` una skill propia (sale de los aliases de `salesforce`).
- `seeds/model_routing.json`: ruteo inicial.
- `seeds/criteria.mauro.json`: `CriteriaRules` v1 calibradas con el golden set.
- `evals/fixtures/golden.json`: 34 ofertas → se cargan como `jobs` + `evaluations(model='human')`.
- `seeds/applicant.example.json`: hechos y respuestas fijas de ejemplo (JS-053). Los reales van en `fixtures-private/applicant.json` y se cargan con `pnpm applicant:sync` (no con `db:seed`).
