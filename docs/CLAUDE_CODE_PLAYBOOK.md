# Playbook para Claude Code — prompts por fase

Uso: un prompt por sesión. Entre bloques, `/clear`. Dentro de un bloque largo, `/compact` cuando el contexto pase el 60%. Claude Code lee `CLAUDE.md` solo; los prompts de abajo solo le dicen **qué bloque ejecutar** y **cómo reportar**.

Antes de la primera sesión (una sola vez, a mano):
1. Descomprimir el zip en una carpeta vacía, `git init`, primer commit "docs: planificación v1".
2. Crear el repo en GitHub y hacer push (`main` protegida: PR obligatorio).
3. Docker Desktop corriendo. En Windows, Claude Code dentro de WSL2 (Ubuntu) evita problemas con pnpm y Testcontainers.
4. Crear `.env.local` en la raíz con las variables de la sección "Variables de entorno". Nunca pegar claves en el chat de Claude Code; él lee el archivo.
5. Proyecto Supabase creado (free tier), `DATABASE_URL` y keys en `.env.local`.

---

## Prompt 0 — Bootstrap de sesión (correr una vez al inicio de cada bloque)

```
Leé CLAUDE.md, docs/PRD.md, docs/ARCHITECTURE.md y docs/BACKLOG.md.
Después leé solo los ADRs que el bloque de hoy necesite.
Confirmame en 5 líneas: qué bloque vamos a ejecutar, qué tickets incluye,
en qué orden por dependencias, y qué tickets quedan bloqueados si uno falla.
No escribas código todavía.
```

---

## Prompt 1 — Bloque 1: Fundaciones (JS-001 → JS-006)

```
Ejecutá el bloque 1 del backlog (JS-001, JS-002, JS-003, JS-004, JS-005, JS-006),
uno por uno, en ese orden, sin saltear.

Para cada ticket:
1. Creá la rama feat/JS-00X-<slug> desde main.
2. Leé el ticket en docs/BACKLOG.md y los archivos que referencia.
   JS-003 copia packages/db/schema.ts tal cual está; no lo rediseñes.
   JS-004 carga evals/fixtures/golden.json como jobs + evaluations(model='human').
   JS-005 lee los modelos de packages/db/seeds/model_routing.json; nunca hardcodees un modelo.
3. Implementá. Si el ticket toca packages/pipeline, tests primero.
4. Corré pnpm lint && pnpm typecheck && pnpm test. No sigas con rojo.
5. Verificá el criterio de aceptación del ticket y mostrame la evidencia (salida del comando, filas en DB, etc.).
6. Commit con mensaje "feat(JS-00X): <qué>". Mergeá a main localmente (fast-forward) y seguí con el siguiente.
7. Marcá el ticket como done en docs/BACKLOG.md con la fecha.

Si algo es ambiguo, elegí la opción más simple, anotala en el commit y seguí.
Si un ticket se bloquea (falta una variable de entorno, una API no responde, etc.),
no inventes: dejalo en "doing" con una nota clara de qué necesitás de mí, y pasá al siguiente ticket que no dependa de él.

Al terminar JS-006: corré los evals con gemini-3.5-flash y con gemini-2.5-flash,
pegame la tabla de métricas (MAE, recall de bloqueadores, acc de disciplina y acción, falsos aplicar)
y los 5 jobs con mayor delta entre score del modelo y score humano, con una hipótesis por cada uno.
No modifiques el prompt todavía; eso es JS-006b y lo decido yo.

Reporte final del bloque en ≤ 15 líneas: tickets done, tickets bloqueados y por qué, comandos para reproducir.
```

---

## Prompt 2 — Bloque 2: Pipeline puro e ingesta (JS-007 → JS-013)

```
Ejecutá el bloque 2 del backlog: JS-007, JS-008, JS-009, JS-010, JS-011, JS-012, JS-013, en ese orden.
Mismas reglas de trabajo que el bloque 1 (rama por ticket, tests primero en packages/pipeline,
checks verdes antes de commit, criterio de aceptación con evidencia, backlog actualizado).

Restricciones específicas:
- packages/pipeline no importa db ni adapters ni hace I/O. Si te ves obligado a hacerlo, pará y explicame.
- JS-008: los pares de evals/fixtures/golden.json → dedup_pairs son tests obligatorios. (19,20) duplicado; (6,7) NO duplicado.
- JS-010: solo campos disponibles en un email de alerta. prefilter_expectations del golden son tests obligatorios,
  incluida la excepción del id 13 (cap 5, no descarte).
- JS-011: decide() recalcula la acción en código; el LLM solo propone.
- JS-012: antes de escribir el adapter, hacé una llamada real a la API pública de Get on Board para confirmar
  slugs de categorías, campos de salario y de modalidad remota. Pegame el JSON de una oferta real.
- JS-013: si pgmq no está disponible en el proyecto Supabase, usá una tabla queue propia con SKIP LOCKED
  y dejá la interfaz del adapter igual. Anotalo como deuda en el commit.

Al terminar: corré el cron de ingesta a mano contra la DB local, después el de evaluación,
y mostrame `select title, company_raw, status, score from jobs join evaluations ... order by score desc limit 10`.
Corré la ingesta una segunda vez y demostrá que no duplica.

Reporte final del bloque en ≤ 15 líneas.
```

---

## Prompt 3 — Bloque 3: UI mínima, CI y deploy (JS-014 → JS-019)

```
Ejecutá el bloque 3 del backlog: JS-014, JS-015, JS-016, JS-017, JS-018, JS-019, en ese orden.
Mismas reglas de trabajo.

Restricciones específicas:
- Server Components por defecto. "use client" solo en filtros interactivos, botones de estado y el textarea de JD.
- Framer Motion solo en client components y solo para transiciones de lista. Nada decorativo.
- Mobile-first: la lista y la cola de JD tienen que ser usables en 390px de ancho.
- Server Actions para cambiar estado; validá con transition() de JS-011. Nunca cambies jobs.status directo desde la UI.
- JS-017: incluí en la página un bloque de texto copiable con la instrucción para Claude in Chrome:
  "Extraé el texto completo de la descripción de este puesto, incluidos requisitos, responsabilidades, salario y ubicación. Devolvelo en texto plano sin resumir."
- JS-018: el job de evals corre solo si cambian packages/prompts/** o evals/**. Usá secrets, nunca claves en el yml.
- JS-019: yo creo el proyecto en Vercel y cargo las envs; vos preparás vercel.json, el endpoint /api/health
  y el script de migraciones. Decime exactamente qué envs tengo que cargar y en qué orden hacer el deploy.

Antes de cerrar: Playwright con los 3 flujos del doc de testing (login → lista con filtros; pegar JD → evaluación aparece; cambiar estado → persiste). Pueden correr contra localhost.

Reporte final del bloque en ≤ 15 líneas, más la checklist de deploy para mí.
```

---

## Prompt 4 — Bloque 4: Ingesta por email (JS-020 → JS-023)

```
Ejecutá el bloque 4 del backlog: JS-020, JS-021, JS-022, JS-023.
Mismas reglas de trabajo.

Antes de JS-020 leé docs/adr/003-*. El proveedor de inbound lo decido yo (Resend por defecto);
vos implementás el webhook con verificación de firma y un adapter con interfaz que permita cambiar de proveedor.

JS-021: yo te dejo 5 emails reales de alertas de LinkedIn en evals/fixtures/emails/ (anonimizados).
Si no están, pará y pedímelos; no inventes HTML.
El parser falla cerrado: estructura no reconocida → inbound_emails.parser = 'none' y cola manual.

Reporte final del bloque en ≤ 15 líneas.
```

---

## Prompt R — Retomar una sesión interrumpida

```
Leé CLAUDE.md y docs/BACKLOG.md. Mirá git log --oneline -20 y git status.
Decime en 5 líneas: último ticket done, ticket en "doing" si hay, qué falta para cerrarlo,
y si hay cambios sin commitear. Después continuá con ese ticket aplicando las reglas del bloque.
```

## Prompt C — Cambio de prompt del evaluador (JS-006b y sucesivos)

```
Vamos a iterar el prompt del evaluador. Creá packages/prompts/evaluate_job.v1.1.md (no edites v1).
Cambios: <lista concreta de qué corregir, tomada del reporte de evals>.
Corré los evals con v1 y v1.1 con el mismo modelo, pegame la comparación (pnpm evals compare),
y no cambies prompt_version en el código hasta que yo apruebe.
```

---

## Variables de entorno (`.env.local`, nunca en el repo)

```
DATABASE_URL=                 # Supabase (pooler, modo transaction) o local: postgres://postgres:postgres@localhost:54322/jobsearch
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=    # solo server; crons y webhooks
GEMINI_API_KEY=
ANTHROPIC_API_KEY=            # opcional en fase 1 (juez y fallback)
CRON_SECRET=                  # random de 32+ chars; Vercel lo manda en el header Authorization
RESEND_WEBHOOK_SECRET=        # bloque 4
INGEST_DOMAIN=                # bloque 4, ej. ingest.<tu-dominio>
```

## Qué hacer vos, no Claude Code

- Crear cuentas y proyectos (GitHub, Supabase, Vercel, Resend) y cargar envs.
- Aprobar cada bloque antes del siguiente. Revisar los PRs o al menos `git log` y el reporte.
- Puntuar a mano las ofertas nuevas desde la UI (`human_score`): es lo que hace crecer el golden set.
- Decidir sobre el prompt v1.1 con el reporte de evals en la mano.
