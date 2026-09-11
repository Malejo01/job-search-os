# Arquitectura — Job Search OS

## 1. Vista general

```
                 ┌──────────────────────────────────────────────────┐
  FUENTES        │                 INGESTA (adapters)                │
  ─────────      │  getonboard.ts   email-inbound.ts   manual.ts     │
  GoB API   ───► │  (API pública)   (webhook Resend)   (UI / MCP)    │
  Email fwd ───► │        │                │                │        │
  Manual    ───► │        └────────────────┴────────────────┘        │
                 │                         ▼                         │
                 │              RawJob (normalizado, sin LLM)        │
                 └─────────────────────────┬────────────────────────┘
                                           ▼
                 ┌──────────────────────────────────────────────────┐
                 │              PIPELINE (funciones puras)           │
                 │  1. dedup()        → fusiona fuentes o descarta   │
                 │  2. prefilter()    → descarta con reglas          │
                 │  3. needsJD()      → cola pendiente_jd            │
                 │  4. evaluate()     → LLM → EvaluationJSON         │
                 │  5. decide()       → accion (código, no LLM)      │
                 └─────────────────────────┬────────────────────────┘
                                           ▼
                 ┌──────────────────────────────────────────────────┐
                 │   Postgres (Supabase, RLS por user_id)            │
                 │   jobs · evaluations · applications · skills ...  │
                 └───────┬──────────────────────────┬───────────────┘
                         ▼                          ▼
              Next.js App Router               Servidor MCP propio
              (lista, cola JD, agenda)         (operar desde Claude)
                         ▲
              Claude in Chrome (humano pega JD)
```

## 2. Monorepo

```
job-search-os/
├── apps/web/                 Next.js 15 App Router. Server Components por defecto.
│   ├── app/(auth)/           login (Supabase Auth)
│   ├── app/(app)/jobs/       lista, detalle, cola JD
│   ├── app/(app)/market/     agenda de mercado
│   ├── app/(app)/profile/    perfil y skills
│   ├── app/api/cron/         endpoints protegidos por CRON_SECRET (Vercel Cron)
│   ├── app/api/inbound/      webhook de email (Resend)
│   └── app/api/mcp/          servidor MCP (fase 2)
├── packages/db/              Drizzle schema, migraciones, seeds, tipos
├── packages/pipeline/        dedup, prefilter, evaluate, decide, skills-normalize
│                             (funciones puras: (input, ctx) => output; sin I/O directo)
├── packages/adapters/        queue | storage | cron | llm | sources
│   ├── llm/                  Vercel AI SDK; router por tabla model_routing
│   ├── queue/                pgmq (hoy) | sqs (AWS)
│   ├── storage/              supabase-storage (hoy) | s3 (AWS)
│   └── sources/              getonboard, email-linkedin, email-generic, manual
├── packages/prompts/         prompts versionados como .md + loader
├── evals/                    golden dataset, runner, reportes
├── infra/                    docker-compose.yml (Postgres 16 + pgvector, LocalStack)
├── docs/
└── .github/workflows/        ci.yml
```

**Regla de dependencia:** `apps/web` → `packages/*`. `packages/pipeline` no importa nada de `adapters` ni de `db`; recibe los datos ya cargados y devuelve decisiones. Eso es lo que lo hace testeable sin infraestructura y portable a Lambda.

## 3. Flujo de datos, paso a paso

| Paso | Dónde corre | Entrada | Salida | LLM |
|---|---|---|---|---|
| Ingesta GoB | cron cada 6 hs | API pública `/jobs` con filtros remoto + categorías | `RawJob[]` | no |
| Ingesta email | webhook por email | HTML del email | `RawJob[]` (0–N por email) | no |
| Ingesta manual | UI / MCP | URL + texto pegado | `RawJob` | no |
| Dedup | inmediato tras ingesta | `RawJob` + últimos 14 días del mismo user | `merge(job_id)` \| `insert` | no |
| Prefiltro | inmediato | `Job` con campos del email | `pass` \| `discard(reason)` | no |
| ¿Tiene JD? | inmediato | `Job` | `evaluate` \| `pending_jd` | no |
| Evaluación | cola | `Job` + `Profile` + `SkillLevels` | `EvaluationJSON` | sí |
| Decisión | inmediato | `EvaluationJSON` | `accion`, `estado` | no |
| Extracción de skills | cola (fase 2) | `Job.jd_text` | `job_skills[]` normalizados | sí + fuzzy |

## 4. Multi-tenant

- Toda tabla de datos tiene `user_id uuid not null references auth.users`.
- RLS: `user_id = auth.uid()` para select/insert/update/delete. Las tablas de catálogo (`skills`, `learning_resources`, `model_routing`) son globales de solo lectura para usuarios.
- Los crons y webhooks usan `service_role` y filtran por `user_id` explícitamente; nunca leen sin filtro.
- Perfil y criterios de evaluación viven en `profiles` y `evaluation_criteria` (JSONB versionado), no en el prompt.
- Cada usuario tiene `inbound_address` único para forwarding de emails.

## 5. Human-in-the-loop

Puntos donde el humano es obligatorio:
1. Leer la JD completa en LinkedIn (Claude in Chrome, ≤ 5/día).
2. Confirmar la postulación (el sistema nunca aplica).
3. Aprobar niveles de skill propuestos por la entrevista dirigida.
4. Aprobar recursos de formación propuestos por el LLM.

Puntos donde el código decide sin humano: dedup, prefiltro, acción sugerida a partir del score, prioridad de skills.

## 6. Modelos y ruteo

Tabla `model_routing (task, provider, model, fallback_model, max_tokens, temperature, updated_at)`. El adapter `llm` lee la tabla, cachea 5 min, y expone `generateStructured(task, schema, input)`. Cambiar de modelo = un UPDATE + correr evals. Ver ADR-005.

## 7. Observabilidad

- `llm_calls`: task, model, tokens in/out (out incluye thinking; `tokens_reasoning` lo separa), latencia, costo estimado con las tarifas de `model_routing`, job_id, error. Guardarraíles de costo en `docs/LLM_COSTOS.md`: estimación previa en evals, tope diario del worker (`LLM_DAILY_CAP_USD`), timeout por llamada y por corrida.
- Sentry en `apps/web` y en handlers.
- Logs estructurados (pino) con `user_id`, `job_id`, `run_id`.

## 8. Seguridad y privacidad

- Secretos en env de Vercel / Secrets Manager. Nunca en repo.
- Webhook inbound valida firma del proveedor y rate-limit por `inbound_address`.
- CV y PDFs en bucket privado con URLs firmadas de 5 min.
- Borrado de cuenta = borrado en cascada + storage.

## 9. Qué NO hay en la arquitectura

- Ningún componente que navegue LinkedIn de forma automatizada.
- Ningún componente que envíe postulaciones.
- Ningún prompt hardcodeado en el código: viven en `packages/prompts` con versión.
