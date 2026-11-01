# Arquitectura — Job Search OS

## 1. Vista general

```
                 ┌──────────────────────────────────────────────────┐
  FUENTES        │                 INGESTA (adapters)                │
  ─────────      │  getonboard.ts   email-inbound.ts   manual.ts     │
  GoB y pool ──► │  (API pública)   (webhook Resend)   (UI / MCP)    │
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
                 │   Postgres (Neon, RLS por user_id)                │
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
│   ├── app/(auth)/           login, registro y recuperación (Auth.js, ADR-010)
│   ├── app/(app)/            ofertas, bandeja, postulaciones, mercado, plan y ajustes
│   ├── app/(public)/         vitrina pública y demo (docs/VITRINA.md)
│   ├── app/(public-en)/      versión en inglés de «Cómo está hecho» (/en/how-its-built)
│   ├── app/onboarding/       alta del perfil
│   ├── app/api/cron/         endpoints protegidos por CRON_SECRET (los dispara GitHub Actions)
│   ├── app/api/inbound/      webhook de email (Resend, firma Svix)
│   └── app/api/mcp/          servidor MCP (token propio)
├── packages/db/              Drizzle schema, migraciones, seeds, tipos
├── packages/pipeline/        dedup, prefilter, evaluate, decide, skills-normalize
│                             (funciones puras: (input, ctx) => output; sin I/O directo)
├── packages/adapters/        queue | storage | cron | llm | sources
│   ├── llm/                  Vercel AI SDK; router por tabla model_routing
│   ├── queue/                Postgres con SKIP LOCKED (hoy) | sqs (AWS)
│   ├── storage/              raw_blobs en Postgres (hoy) | s3 (AWS)
│   └── sources/              getonboard, ATS públicos y feeds del pool (ADR-014, ADR-018)
├── packages/prompts/         prompts versionados como .md + loader
├── evals/                    golden dataset, runner, reportes
├── infra/                    docker-compose.yml (Postgres 16 + pgvector; LocalStack comentado)
├── docs/
└── .github/                  workflows (ci, cron, carril, smoke), CODEOWNERS y carril-rojo.txt
```

**Regla de dependencia:** `apps/web` → `packages/*`. `packages/pipeline` no importa nada de `adapters` ni de `db`; recibe los datos ya cargados y devuelve decisiones. Eso es lo que lo hace testeable sin infraestructura y portable a Lambda.

## 3. Flujo de datos, paso a paso

| Paso | Dónde corre | Entrada | Salida | LLM |
|---|---|---|---|---|
| Ingesta GoB | cron cada 6 hs (GitHub Actions) | API pública `/jobs` con filtros remoto + categorías | `RawJob[]` | no |
| Ingesta email | webhook por email | HTML del email | `RawJob[]` (0–N por email) | no |
| Ingesta manual | UI / MCP | URL + texto pegado | `RawJob` | no |
| Dedup | inmediato tras ingesta | `RawJob` + últimos 14 días del mismo user | `merge(job_id)` \| `insert` | no |
| Prefiltro | inmediato | `Job` con campos del email | `pass` \| `discard(reason)` | no |
| ¿Tiene JD? | inmediato | `Job` | `evaluate` \| `pending_jd` | no |
| Evaluación | cola | `Job` + `Profile` + `SkillLevels` | `EvaluationJSON` | sí |
| Decisión | inmediato | `EvaluationJSON` | `accion`, `estado` | no |
| Extracción de skills | cola (fase 2) | `Job.jd_text` | `job_skills[]` normalizados | sí + fuzzy |

### Carreras e idioma

- **Carreras.** Las carreras que una persona puede elegir son las `ROLE_KEYS` de `packages/pipeline/src/skills/self-assessment.ts`. Hoy son 20: las de tecnología, las digitales (ADR-015), las de producto (ADR-019), `data_engineer` y `solutions_engineer` (ADR-021), y `ventas_b2b` y `atencion_cliente` (ADR-022). Las nuevas siempre se agregan al final. Si la persona no eligió carrera, valen solo las de tecnología previas a la ronda 40 (`IT_ROLE_KEYS`); las de las rondas 106 y 107 no se suman a ese default. Cada carrera tiene su vista en el mercado (`pool/career/`). Las no listadas (`UNLISTED_ROLE_KEYS`) se ocultan en las páginas públicas, los chips de `/mercado` y el sitemap; dentro de la app, `profileRoleGroups()` ofrece siempre las de la beta (`BETA_ROLE_KEYS`), y la invitación de la lista de espera precarga la carrera elegida (C5-1). A los avisos ya guardados se les vuelve a asignar carrera con `pool:rehint`, fuera del cron.
- **Licencia profesional (ADR-022).** `prefilter/licensing.ts` reconoce un conjunto estricto de frases de habilitación profesional, como abogacía, enfermería o contaduría. Si el texto nombra el país de la persona cerca de la frase, no descarta. Si no se conoce el país de la persona, la regla no corre. Las frases de licencia de conducir quedan afuera a propósito.
- **Idioma del aviso.** `normalize/language.ts` (`detectJobLanguage`) decide si un aviso está escrito en español, inglés o portugués. Es determinista y sin LLM; cuando no hay evidencia suficiente devuelve `null` en vez de adivinar. Lo usa el mercado para contar los avisos escritos en español. No reemplaza a `detectEnglish`, que usa el prefiltro para el nivel de inglés que pide el aviso.

## 4. Multi-tenant

- Toda tabla de datos tiene `user_id uuid not null references users` (tabla de Auth.js, ADR-010).
- RLS: `user_id = auth.uid()` para select/insert/update/delete. En Neon y Docker `auth.uid()` es una función propia que lee `app.user_id`; la app se conecta con el rol `jobsearch_app`, sin `BYPASSRLS` y con `FORCE ROW LEVEL SECURITY` (ADR-009). Las tablas de catálogo (`skills`, `learning_resources`, `model_routing`) son globales de solo lectura para usuarios.
- Los crons y webhooks usan el rol dueño (purpose `service`, ADR-010) y filtran por `user_id` explícitamente; nunca leen sin filtro.
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
- Logs estructurados (pino) con `user_id`, `job_id`, `run_id`.

## 8. Seguridad y privacidad

- Secretos en env de Vercel / Secrets Manager. Nunca en repo.
- Webhook inbound valida la firma Svix del proveedor (`apps/web/app/api/inbound/route.ts`).
- Los crudos de ingesta (HTML de emails) viven en `raw_blobs` (Postgres, con RLS por usuario) y el HTML de afuera nunca se inyecta en la página: va en un `iframe` con `sandbox` vacío.
- El archivo de un CV no se guarda en ningún storage (ver §10).
- Borrado de cuenta = borrado en cascada + storage.

## 9. Qué NO hay en la arquitectura

- Ningún componente que navegue LinkedIn de forma automatizada.
- Ningún componente que envíe postulaciones.
- Ningún prompt hardcodeado en el código: viven en `packages/prompts` con versión.

## 10. Lectura de CV (en construcción, apagada)

La persona puede subir su CV (PDF o Word) para que el sistema le proponga el resumen del perfil, los años de experiencia, el inglés y los niveles de skills. Siempre es opcional y la persona revisa y confirma antes de guardar. Por ahora están hechas la etapa 1 del pipeline (CV-01) y la orquestación en adapters (CV-03). Lo demás es diseño, y la función sigue apagada.

**Qué corre dónde.** El requisito es que el archivo se lea sin ejecutar macros, con tope de tamaño y de páginas y con el tipo validado por contenido. La decisión vigente es parsear en el servidor; leerlo en el navegador (CV-04) es una alternativa **a confirmar**.

| Etapa | Dónde | Qué hace |
|---|---|---|
| Tipo y texto | Servidor (a confirmar) | Verifica el tipo por contenido (no por extensión), extrae el texto del PDF o del DOCX sin ejecutar macros y aplica los topes de tamaño y de páginas. También se acepta texto pegado |
| Redacción | Servidor, antes del LLM | Saca con reglas, cuando se puede, documento, dirección, fecha de nacimiento o edad, estado civil, email, teléfonos y links, y el nombre de la cuenta. No se guardan |
| Candidatas | Servidor | Arma por reglas, sin LLM, la lista de skills de la taxonomía que aparecen en el texto |
| Extracción | Servidor → LLM | La tarea `extract_cv_profile` (ruteada por `model_routing`) recibe **solo el texto redactado**, delimitado como dato no confiable, y devuelve un objeto con esquema estricto |
| Verificación | Servidor (código) | El modelo propone y el código decide: descarta skills fuera de la lista, precarga un nivel solo si la skill aparece literal en el CV, y pasa el detector de inyección sobre el resumen |
| Confirmación | Interfaz | La persona revisa y ajusta antes de guardar; al re-subir se le muestran las diferencias y acepta o rechaza cada cambio. Dónde vive la propuesta mientras tanto (pestaña o servidor) está **a confirmar** |

**Qué se guarda:** solo lo extraído y confirmado por la persona: perfil (puesto, años, inglés, ubicación, resumen), skills con nivel, y también hechos verificables (`candidate_facts`, marcados como autodeclarados) e historial laboral. Qué tablas reciben esto último está **a confirmar**: la etapa 1 solo cubre `profiles` y `skill_levels`. No se guarda el archivo ni en storage ni en la base. Del uso queda el registro sin contenido en `llm_calls`. Esto reemplaza para el CV la idea de bucket privado de ADR-008 y se va a formalizar en un ADR nuevo (CV-07). Los topes de gasto son los de `docs/LLM_COSTOS.md` más los propios de la tarea, y la función se enciende con una variable de entorno que pone Mauro.

**Estado:**

- **Hecho (CV-01):** `packages/pipeline/src/cv/**`, funciones puras sin I/O: tipo por contenido (`sniff.ts`), texto de DOCX (`docx-text.ts`), redacción (`redact.ts`), normalización del texto (`normalize-text.ts`), skills candidatas (`candidates.ts`), detector de inyección (`injection.ts`), variables del prompt (`prompt-vars.ts`), esquema estricto y normalización de la salida (`extraction.ts`) y los topes (`limits.ts`).
- **Hecho (CV-03):** `packages/adapters/src/cv/extract.ts` orquesta la lectura sobre texto ya extraído:
  - Vuelve a normalizar y redactar el texto, porque no confía en lo que manda el cliente.
  - Detecta inyección, arma las candidatas y llama a la tarea `extract_cv_profile`. Verifica la salida con el código del CV-01.
  - Antes de llamar, controla el cupo mensual por persona: 1 lectura en el plan gratis y 5 en el pago, en una ventana móvil de 30 días que se cuenta sobre `llm_calls`.
  - También exige el chequeo de topes en USD (`capGuard`). Si ese chequeo falta, falla cerrado.
  - No escribe nada propio. Los logs llevan solo `user_id`, códigos y conteos.
  - Para encenderla falta un lock del cupo (lecturas simultáneas de la misma persona) y un límite para cuentas nuevas.
- **Diseño pendiente (CV-02 y CV-04 a CV-07):** prompt y fila de ruteo (CV-02), lectura de PDF y DOCX en el navegador, que suma dependencias (CV-04), la interfaz del onboarding y de skills (CV-05), la edición desde Ajustes (CV-06) y el texto legal, el ADR y estos docs (CV-07). Antes hace falta una pantalla «Tu perfil» en Ajustes (CV-00).
- **Alcance buscado:** perfil, skills, hechos verificables e historial laboral; formatos PDF (incluido el export de LinkedIn), DOCX y texto pegado; un CV base y la posibilidad de subir otro para una carrera puntual; comparación al re-subir. Parte de esto (hechos, historial, comparación) queda para etapas posteriores a la 1.

## 11. Carril verde y carril rojo

Los cambios chicos y de bajo riesgo (texto de UI, componentes, tests, docs) pueden mergearse solos; todo lo que toca datos, seguridad, costos o temas legales lo mergea una persona. La lista de lo que es «rojo» está en `.github/carril-rojo.txt` y se repite en `.github/CODEOWNERS`, con un test que verifica que coincidan. Un PR que toca cualquier path rojo necesita la aprobación del code owner y no entra por el carril verde.

El check `carril` (`.github/workflows/carril.yml`) corre con `pull_request_target`, así que el workflow, el script y la lista roja salen siempre de `main` y un PR no puede cambiar las reglas con las que se lo juzga. No descarga ni ejecuta el código del PR: la lista de archivos viene de la API. Pasa solo si el PR tiene la etiqueta `carril-verde`, viene de una rama del mismo repo, la pausa no está activa y no toca nada del carril rojo.

Con `carril` y el CI en verde, el auto-merge con squash mergea solo. Quien opera los PR solo puede activarlo con las tres formas exactas (`gh pr ready`, `gh pr edit --add-label carril-verde` y `gh pr merge --auto --squash`); nunca mergea directo ni con permisos de admin. Después de cada deploy a Production, `smoke.yml` corre un smoke de solo lectura y, si falla, abre un issue `smoke-roto`. El detalle, la pausa y el rollback están en [`docs/CARRIL_VERDE.md`](./CARRIL_VERDE.md).
