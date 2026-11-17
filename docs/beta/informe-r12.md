# Informe de la tanda R12 «Coach de CV» (17/11)

Trabajaron cinco teammates, cada uno en su worktree: historial, chat, lectura, coach y turno. El lead hizo
R12-7 (contrato) y R12-16 (test intermitente), revisó y probó las mezclas. **Ningún PR se mergeó.** Todas
las ramas salen de `origin/ronda/integracion-r11` (PR #517) o de otra rama de la R12 (columna «Sale de»).

Decisiones de Mauro del 17/11 (D1 a D7, flag `CV_COACH`, diagnóstico con plantillas, reserva del CV final):
escritas en [ADR-038](../adr/038-coach-de-cv.md), que pasó a **Accepted** en R12-7.

## 1. PRs, en el orden de merge sugerido

| Orden | PR | Ticket | Sale de | Carril | Antes de mergear |
|---|---|---|---|---|---|
| 1 | [#519](https://github.com/Malejo01/job-search-os/pull/519) | R12-16 · la lectura cierra bajo el lock (carrera real) | integración R11 | rojo | — (destraba el job `integration` de todos los demás) |
| 2 | [#522](https://github.com/Malejo01/job-search-os/pull/522) | R12-4 · Proyectos en `career_history` y en el CV | integración R11 | rojo | **Migración 0066** (§5) |
| 3 | [#520](https://github.com/Malejo01/job-search-os/pull/520) | R12-2 · multi-campo, `cv_interview@v3`, repreguntas en huecos | R12-4 | rojo | Conflicto de una línea (§2) |
| 4 | [#526](https://github.com/Malejo01/job-search-os/pull/526) | R12-3 · acuse armado por el código y «¿Cuál dejo?» | R12-2 | verde | — |
| 5 | [#528](https://github.com/Malejo01/job-search-os/pull/528) | R12-6 · puerta «Tengo CV / No tengo CV» | integración R11 | rojo | — |
| 6 | [#521](https://github.com/Malejo01/job-search-os/pull/521) | R12-12 · PDF con `pdfjs-dist@6.5.438` | integración R11 | rojo | Dependencia nueva |
| 7 | [#524](https://github.com/Malejo01/job-search-os/pull/524) | R12-14 · guía de la prueba de Ani | integración R11 | verde | — |
| 8 | [#529](https://github.com/Malejo01/job-search-os/pull/529) | R12-15 · indicador de carga (vuelve R11-8) | integración R11 | verde | — |
| 9 | [#518](https://github.com/Malejo01/job-search-os/pull/518) | R12-7 · contrato del coach, ADR-038 Accepted | integración R11 | verde | — |
| 10 | [#527](https://github.com/Malejo01/job-search-os/pull/527) | R12-5 · viñetas «de tu CV» y tarjeta de proyectos | R12-4 + R12-7 | rojo | Prompt `extract_cv_profile@v2` |
| 11 | [#523](https://github.com/Malejo01/job-search-os/pull/523) | R12-8 · diagnóstico `cv_review` y reserva del coach | R12-7 | rojo | **Filas de `model_routing`** (§5) |
| 12 | [#525](https://github.com/Malejo01/job-search-os/pull/525) | R12-9 · turno `cv_coach_turn` | R12-8 | rojo | — |
| 13 | [#530](https://github.com/Malejo01/job-search-os/pull/530) | R12-10 · pantallas y rutas del coach | R12-9 | rojo | `CV_COACH=testers` cuando Mauro decida |
| 14 | [#531](https://github.com/Malejo01/job-search-os/pull/531) | R12-11 · cierre y «qué mejoró» | R12-10 | verde | — |
| 15 | [#532](https://github.com/Malejo01/job-search-os/pull/532) | R12-13 · golden de CVs y harness del coach | R12-11 | rojo | Corridas pagas: las hace Mauro (§5.7) |

Los PRs 1 a 8 son lo que necesita la prueba de Ani del 20/11 (aviso temprano, §3). Del 9 al 15 es la Fase 2,
detrás de `CV_COACH`, apagado por defecto.

## 2. Ramas para la integración (las arma Claude desde la nube)

En este orden, sobre `ronda/integracion-r11`:

```
ronda/r12-16-lectura-concurrente
ronda/r12-4-proyectos
ronda/r12-2-multicampo
ronda/r12-3-acuse
ronda/r12-6-puerta-cv
ronda/r12-12-pdf
ronda/r12-14-prueba-ani
ronda/r12-15-carga-cliente
ronda/r12-7-contrato-coach
ronda/r12-5-lectura-vinetas
ronda/r12-8-cv-review
ronda/r12-9-coach-turn
ronda/r12-10-pantallas-coach
ronda/r12-11-que-mejoro
ronda/r12-13-golden-coach
ronda/r12-cierre
```

- **Único conflicto:** `apps/web/lib/cv-chat-server.ts` al mezclar `ronda/r12-2-multicampo`. Se resuelve
  quedándose con la línea de R12-4: `link: e.link ?? null,`.
- **Probado por el lead (17/11, en local, sin empujar):** las 16 ramas de la lista, mezcladas en ese orden.
  `pnpm lint`, `pnpm typecheck` y `pnpm test` en verde: pipeline 5336, adapters 1187, web 15, db 151,
  evals 162, prompts 31. En una base limpia con la migración 0066, la integración de
  `career_history` dio 7/7 y la de `profile-agent`, `cv-chat`, `cv` y `cv-coach` 92/92. La suite completa
  de integración no se pudo validar en la nube: inbound, métricas y cuentas de prueba dependen del entorno
  del CI. Los e2e (85, 86, 125, 135, 141, 142, 147) quedan para el CI; el 125 solo corre en el PR hacia `main`.
- **En el CI de los PRs**, el job `integration` falla en `read-cv.integration.test.ts` («dos lecturas
  simultáneas») hasta que entre #519. Es la carrera que arregla R12-16, no una falla de cada PR.

## 3. Aviso temprano: integración parcial para la prueba de Ani (20/11)

Ramas 1 a 8 de la tabla (`r12-16`, `r12-4`, `r12-2`, `r12-3`, `r12-6`, `r12-12`, `r12-14` y,
opcional, `r12-15`), con el mismo conflicto de §2. Es la Fase 1 completa, más el PDF, el test intermitente y la guía de Ani
(`docs/beta/coach-cv-prueba.md`, con tres CV inventados y el recorrido «subo mi CV en PDF → tarjetas →
huecos → guía → CV»).

**Opcional para el 20/11:** `ronda/r12-7-contrato-coach` + `ronda/r12-5-lectura-vinetas`, para que las
tarjetas traigan las viñetas «de tu CV» y los proyectos. El contrato no cambia nada visible por sí solo.

## 4. Métricas de la línea de base (transcripción del 17/11)

Fixture pública y ficticia (`packages/pipeline/test/fixtures/cv-chat/transcripcion-17-11.json`: Empresa A,
Proyecto 1 a 4, 18 hechos). La recorre `packages/pipeline/src/cv-chat/baseline.ts` sin modelo, con las
respuestas grabadas y el mismo código de producción (`applyCvModelTurn`).

| | Datos perdidos | Preguntas repetidas | «¿Cuál dejo?» |
|---|---|---|---|
| Antes (`ronda/integracion-r11`) | 5/18 (27,8 %): los 4 proyectos y la segunda opción de puesto | 3/12 (25 %): cargo, fechas y tareas | — |
| Después de R12-2 | 0/18 | 0/10 | — |
| Después de R12-3 | 0/18 | 0/11 | 1 (el cargo dicho de dos formas) |

**Cautela:** las respuestas del modelo con el esquema nuevo las grabó el mismo agente que hizo el cambio.
Los números prueban que el código aprovecha lo que el modelo devuelve, no que el modelo lo devuelva. Lo
confirman la prueba de Ani y una corrida con el modelo real del harness de R12-13 (la hace Mauro).

## 5. Pasos manuales para Mauro

1. **Migración de Proyectos (R12-4)**, con `pnpm db:migrate` después de revisar el SQL. La RLS de
   `career_history` (rls/0014, `FOR ALL` por fila) cubre la columna nueva:
   ```sql
   ALTER TABLE "career_history" DROP CONSTRAINT "career_history_kind";
   ALTER TABLE "career_history" ADD COLUMN "link" text;
   ALTER TABLE "career_history" ADD CONSTRAINT "career_history_link" CHECK ("career_history"."link" is null or ("career_history"."link" ~ '^https://' and char_length("career_history"."link") <= 200));
   ALTER TABLE "career_history" ADD CONSTRAINT "career_history_kind" CHECK ("career_history"."kind" in ('trabajo', 'educacion', 'certificacion', 'proyecto'));
   ```
2. **Filas de `model_routing` (R12-8)** para `cv_review` y `cv_coach_turn`, con guarda:
   ```sql
   BEGIN;
   INSERT INTO model_routing (task, provider, model, fallback_model, temperature, max_tokens, thinking_level,
     input_usd_per_mtok, output_usd_per_mtok, fallback_input_usd_per_mtok, fallback_output_usd_per_mtok)
   VALUES
     ('cv_review', 'google', 'gemini-3.5-flash', 'claude-haiku-4-5', 0, 2048, 'minimal', 1.5, 9, 1, 5),
     ('cv_coach_turn', 'google', 'gemini-3.5-flash', 'claude-haiku-4-5', 0, 1536, 'minimal', 1.5, 9, 1, 5)
   ON CONFLICT (task) DO NOTHING;
   SELECT task, model, fallback_model, max_tokens, thinking_level FROM model_routing
     WHERE task IN ('cv_review', 'cv_coach_turn') ORDER BY task;
   -- debe devolver 2 filas; si no, ROLLBACK
   COMMIT;
   ```
3. **Vercel:** `CV_IMPORT_ENABLED=1` y `CV_PROFILE_AGENT=testers` ya están. `CV_COACH=testers` cuando decidas
   mostrar el coach (Mauro y Ani; misma lista que `ASSISTANT_TESTER_EMAILS` más `ADMIN_EMAILS`). Sin
   definirlo, queda apagado.
4. **Cuentas de Ani:** tres cuentas de prueba, una por CV inventado, en `ASSISTANT_TESTER_EMAILS`.
5. **`pdfjs-dist`:** no quedó pendiente; la versión 6.5.438 se verificó en el registro (publicada el 01/11).
6. **Privacidad:** correr `pnpm secrets:scan` y `node scripts/privacy-scan.mjs`. No corrieron en la nube
   (sin Docker ni `fixtures-private/`). R12-10 sumó a `.gitleaksignore` la huella de la clave inventada del e2e 147.
7. **Evals con el modelo real (R12-13, #532)**, desde `evals/`, con su CV en
   `fixtures-private/cv-coach/mauro.json` (formato en `fixtures-private.example/cv-coach/`):
   ```
   pnpm exec tsx src/cv-coach/cli.ts --modo modelo --db cloud --etapa diagnostico --privadas --dry-run
   pnpm exec tsx src/cv-coach/cli.ts --modo modelo --db cloud --etapa diagnostico --privadas --runs 3 --max-usd 0.60
   pnpm exec tsx src/cv-coach/cli.ts --modo modelo --db cloud --etapa charla --privadas --ids sin-experiencia,con-experiencia,cambio-de-carrera,mauro --max-usd 0.60
   ```
   La charla se corre **dos veces**: con `--runs 2` el estimado pasa el tope y no arranca. Diagnóstico
   ≈ USD 0,17 por corrida y charla ≈ USD 0,45 por corrida: en total ≈ USD 1,41, dentro del tope de la tanda.

## 6. Gasto de evals

- **Corridas pagas del harness del coach:** ninguna. Las hace Mauro (§5.7), con el guard de USD 0,60 por
  corrida y el freno del acumulado en USD 2,50.
- **Job `evals` del CI:** corre una vez por PR que toca `packages/prompts/**` o `evals/**`, mide
  `evaluate_job` con la versión vigente y cuesta ≈ USD 0,16. En la tanda: R12-2, R12-5, R12-8, R12-9 y
  R12-13 (un push de prompt cada uno), **≈ USD 0,80 estimado** si los cinco corrieron con la key
  configurada. El CI corre con `--db none`, así que esas llamadas **no quedan en `llm_calls`**: el número
  real está en el log de cada job.
- **Consulta para lo que sí se registra** (corridas locales con `--db cloud`, label `r12`):
  ```sql
  SELECT task, label, count(*) AS llamadas, round(sum(cost_usd)::numeric, 4) AS usd
  FROM llm_calls
  WHERE task LIKE 'eval:%' AND label LIKE '%r12%' AND created_at >= '2026-11-17'
  GROUP BY task, label ORDER BY usd DESC;
  ```
- Tope de la tanda: USD 3. Gastado estimado: USD 0,80 (todo del CI).

## 7. Qué quedó abierto

- **Misma carrera que R12-16 en otras reservas.** La del coach ya suelta la reserva bajo lock. Las del chat de
  CV y de huecos y cierre del agente de perfil siguen midiendo en varias consultas y soltando sin lock: como
  mucho dejan pasar un turno o una llamada de más con dos pedidos simultáneos, no un cupo de lectura.
- **Arreglos del lead sobre ramas ya terminadas** (después de que el agente dueño cerró):
  - R12-8 (`c734a976`): el gasto del coach entra en la medición compartida del agente, así la lectura, los
    huecos y el cierre ven `cv_review` y `cv_coach_turn` en los topes por persona y día y global.
  - R12-9 (`a076a8ce`) y R12-10 (`a415dd09`): dos bugs que encontró el harness de R12-13. Una skill nombrada
    con un alias de la taxonomía se volvía a preguntar, y la plantilla cortaba el nombre a mitad de paréntesis.
  - R12-6 (`35e9d8aa`): el e2e de la puerta pasó de 141 a 142, porque el 141 es el de PDF de R12-12.
- **Reservas al límite:** la del turno queda en 1,246 veces el máximo (el prompt lleva solo el ítem en foco y
  el siguiente). La del diagnóstico entra porque el CV se recorta a 14 000 caracteres. Turno y coach
  propusieron bajar el turno a USD 0,035 o subir el diagnóstico a 0,06; se decide con las corridas reales.
- **Coach:** las tarjetas de link, de ítem nuevo, de nota o de stack sin ubicar no se guardan desde la
  charla; la pantalla manda a Historial. `resumen_generico` no aparece porque el resumen del CV no está en la
  base.
- **Lectura (R12-5):** `redactCvText` cambia los links por `[link]` antes del modelo, así que el link de un
  proyecto lo completa la persona en la tarjeta. `max_tokens` de `extract_cv_profile` sigue en 4096; si
  aparecen cortes con las viñetas, se sube en el seed.
- **Detalles chicos:**
  - `summaryLine` de la lectura no cuenta proyectos.
  - `close/build-input.ts` no pasa el `link` a la vista previa del cierre.
  - `cv-chat/write.ts` manda los proyectos al resumen dentro de `studies`.
  - `upload-card.tsx` quedó sin uso en `/cv`.
  - Falta la contradicción por empresa (a propósito: puede ser otro trabajo).
  - El commit del revert de R12-15 quedó sin las líneas de atribución.
- **Entorno de la nube:** sin Docker; un Postgres 16 local compartido. El rol `jobsearch_app` es de todo el
  cluster: un test de integración de `db` le cambia la clave y rompe los e2e de los demás. Conviene
  documentarlo en `docs/TESTING_STRATEGY.md`.

## 8. Contexto para revisar rápido

- **Primero:** #519 (es plata: cupos), #522 (migración) y #523 (seed, firma HMAC y reservas).
- **Prompts nuevos:** `cv_interview.v3.md`, `extract_cv_profile.v2.md`, `cv_review.v1.md`,
  `cv_coach_turn.v1.md` y `cv_coach_fallbacks.v1.md`. Todos tratan el CV y el mensaje como dato.
- **Lo que el modelo escribe y llega a pantalla:** solo las preguntas del coach y las repreguntas. Pasan
  validador (una línea, «?», sin dígitos, links ni datos sensibles, sin nombres ajenos, con ancla) o caen a
  plantilla. El diagnóstico y el acuse los arma el código.
