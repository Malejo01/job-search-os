# Auditoría del proyecto al 2026-09-11 (antes del deploy)

Repaso con ojo de auditor: qué quedó a medias, qué tiene tests débiles, qué decisión no está documentada, qué deuda ya es urgente. Priorizado. Nada de esto está arreglado; es el mapa para decidir antes de desplegar.

## P0 · Bloquea o compromete el deploy

1. **Nunca corrió un CI ni un cron en GitHub.** `ci.yml` y `cron.yml` están escritos y probados solo por lectura. Hasta el primer run verde no se sabe si el job `e2e` (Postgres como service + `next start` + Playwright) funciona en Ubuntu, ni si `cron.yml` llega a la app. El nivel de `ci_cd` en `skill_levels` sigue en 1 por esto mismo. Acción: subir el repo, ver el primer run, arreglar lo que rompa antes de confiar en el cron.
2. **El usuario de producción (Neon) no tiene contraseña.** El seed se corrió sin `SEED_USER_PASSWORD`; el login en Vercel va a fallar hasta que se vuelva a correr el seed con `SEED_USER_EMAIL`/`SEED_USER_PASSWORD` (checklist en `docs/DEPLOY.md`).
3. **`ANTHROPIC_API_KEY` y el fallback nunca se probaron en vivo.** `claude-haiku-4-5` quedó fuera del ruteo de `evaluate_job` (ahora el fallback es 3.5-flash, misma key), pero `judge_calibration`, `recruiter_message` y `skill_interview` apuntan a Claude y no hay ninguna llamada real registrada. Si el fallback a Gemini 3.5 falla por cuota, no hay tercer nivel.
4. **Riesgo de ubicación en la carga manual y por MCP (cerrado hoy, 2026-09-11).** `toRawJob` anulaba `location_risk` en todo lo remoto cargado a mano. Arreglado con test de los tres caminos; lo listo porque es el tipo de agujero que puede repetirse en los parsers de email (JS-021/022): cada parser nuevo tiene que pasar por el mismo test de "el riesgo llega a `decide()`".

### Estado de los P0 (actualizado el mismo día)

- **P0.1 CI/cron nunca ejecutados**: depende del push (prioridad 2 del plan). Preparado: los 4 flujos E2E pasan localmente contra `next dev`; en CI corren contra `next start` con Postgres como service. Si el job `e2e` falla en Ubuntu, lo primero a mirar es `playwright.config.ts` (`webServer` y `baseURL`) y que el seed de CI cree el usuario con `SEED_USER_PASSWORD`.
- **P0.2 usuario de Neon sin contraseña**: depende de Mauro (`SEED_USER_EMAIL`/`SEED_USER_PASSWORD` + `pnpm db:seed`), previsto en el deploy.
- **P0.3 Claude nunca probado en vivo**: depende de `ANTHROPIC_API_KEY`. Arreglo propuesto: `pnpm llm:smoke --task judge_calibration` (hoy `llm:smoke` solo prueba `evaluate_job` con Gemini) y una fila en `llm_calls` como evidencia; hasta entonces, las tres tareas de Claude siguen sin usarse en producción, así que no bloquea.
- **P0.4 riesgo de ubicación en carga manual/MCP**: cerrado con tests (commit 57cafcf). Regla para JS-021/022: cada parser nuevo agrega su caso al test "riesgo de ubicación en TODOS los caminos".
- **P1.6 harness**: cerrado el mismo día (métricas por tipo, ubicación exacta, `decide()` completo, `model_raw` y `pnpm evals recompute`). Números en `docs/LLM_COSTOS.md`.

## P1 · A medias o con tests débiles (arreglar en las primeras dos semanas)

5. **`apps/web/lib/*` no tiene tests propios.** Doce módulos (jobs, job-detail, pending-jd, applications, plan, market, prescore, ingest-manual, mcp-user, session, db, labels) solo se ejercitan por los 4 flujos E2E. La lógica que importa vive en pipeline (testeada), pero las consultas con `selectDistinctOn` (última evaluación por job) y el mapeo de eventos → resultado de postulación (`EVENT_OUTCOME`) no tienen test unitario. Un cambio en el orden de `orderBy` rompería "la última evaluación" en silencio.
6. **El harness de evals mide una acción distinta de la de producción.** Aplica `decideAction` + tope de ubicación pero no el resto de `decide()` (cap de título, bloqueador por años ≥ 8, penalizaciones por años 5–7, cloud must e inglés, riesgos del prefiltro). `action_acc` y `false_apply` del subset no son los de producción. Detalle en el informe del harness (mensaje del 2026-09-11) y en `docs/LLM_COSTOS.md`. Además `blockers_recall` y `risks_recall` cuentan "algún bloqueador/riesgo", no el mismo: son métricas indulgentes.
7. **La API de Resend está probada solo contra un mock.** `fetchReceivedEmail` y el formato real del evento `email.received` se validaron con la documentación, no con un email de verdad. El primer email real puede fallar en el parseo del payload (cae en 500 → Svix reintenta, no se pierde, pero hay que mirar).
8. **`/api/mcp` no tiene test.** Siete tools con token compartido, sin test de auth (token ausente/incorrecto → 401) ni de que `set_status` respete `transition()`. Se probó a mano una vez.
9. **`market_snapshots` y el plan usan `skill_levels` autodeclarados.** Hasta la entrevista dirigida (JS-033) los niveles son los que Mauro escribió el 2026-09-11; el plan de formación hereda ese sesgo. La fórmula de facilidad (lineal vs raíz) sigue sin decidir.
10. **Los E2E dependen del dev server y de datos vivos.** Reusan `next dev` en :3000 y el usuario seed; crean y borran sus jobs, pero un job huérfano en `job_queue` (visto hoy) puede quedar si un test falla a mitad. En CI corren contra `next start` limpio, que es distinto de lo probado localmente.

## P2 · Decisiones tomadas sin ADR o documentadas solo en el hilo

11. **Cron en GitHub Actions en vez de Vercel Cron.** Está en `docs/DEPLOY.md` con la decisión de Mauro, pero no como ADR; es una decisión de arquitectura (ADR-007 menciona EventBridge → HTTP como patrón). Merece ADR-012 corto.
12. **Storage de crudos en Postgres (`raw_blobs`).** ADR-007 habla de S3 diferido; la tabla y el adapter existen sin ADR que fije cuándo se migra (tamaño, retención de 30 días de Resend, costo en Neon Free de 0,5 GB).
13. **Auth con JWT y sin registro.** ADR-010 dice "sesión en base de datos"; la implementación usa JWT (Credentials obliga). El ADR no se enmendó.
14. **`thinking_level: minimal` como default y flash-lite primario.** Está en `LLM_COSTOS.md` y ADR-011 cubre disciplina, pero el cambio de modelo primario (ADR-005 decía 3.5-flash) no tiene enmienda en ADR-005.
15. **Golden corregido dos veces.** Las notas están en el fixture; conviene un párrafo en `evals/README.md` con la política: cuándo se puede tocar el golden y quién.

## P3 · Deudas ya anotadas que suben de prioridad

16. **FK `profiles.user_id → users.id`** (diferida en ADR-010). Con el deploy, el seed y Auth.js escribiendo de verdad, una FK evita perfiles huérfanos si se borra o recrea el usuario. Sigue siendo decisión de Mauro esperar.
17. **`skill_levels.ci_cd` = 1 hasta el primer run verde.** Cuando pase, actualizar el seed y recalcular snapshot y plan (cambia el orden del plan).
18. **Notion sin bloques libres** (gracia hasta 2026-09-14). Después de esa fecha las actualizaciones de estado desde Claude fallan; o se paga, o el estado vive solo en README/BACKLOG.
19. **Rate limit de inbound por usuario (100/hora) sin test de tiempo real.** Está probado en integración con conteo, no con la ventana móvil bajo carga.
20. **`evals/reports/` versionados en git.** Ya son 12 archivos JSON; van a crecer con cada corrida. Decidir si se ignoran (y se guardan en `llm_calls`) o se conservan solo los de decisión.

## Lección del primer push (2026-09-11)

El repo se publicó sin pasar antes un escáner de secretos local. GitGuardian avisó sobre el commit inicial; la revisión (comparar cada valor real de `.env.local` contra el árbol versionado, `git grep` por patrones, `git check-ignore`) mostró que era un falso positivo: URLs de Postgres de Docker/CI con `user:password@localhost`, la contraseña de desarrollo del E2E y un literal `whsec_` en un test. Salió bien esta vez; la próxima puede no salir. Reglas que quedan:

- **Antes de publicar cualquier repo se corre un escáner offline**: `pnpm secrets:scan` (gitleaks vía Docker, modo git, sobre toda la historia). Si encuentra algo, se resuelve antes del push.
- **El CI tiene el job `secrets`** (gitleaks sobre toda la historia, falla en rojo). Sin archivos de excepción (`.gitguardian.yaml` o allowlists): silenciar `ci.yml` o los helpers hoy es un punto ciego mañana, justo donde van a vivir las credenciales. Los falsos positivos se marcan por incidente en el panel del escáner.
- Nada de literales con prefijo de secreto real en tests (`whsec_`, `sk-`, `npg_`): se calculan en el test.

## Lo que está bien y no hace falta tocar

- `packages/pipeline`: 201 tests, tests primero, sin I/O. Dedup, prefiltro, `decide()`, estados, skills, plan, pre-score y feedback cubiertos.
- RLS con `FORCE` en todas las tablas de usuario, rol de app sin `BYPASSRLS`, test de aislamiento. `assertAppRole` en el layout.
- Guardarraíles de costo: tarifas reales, `tokens_reasoning`, estimación con historia, tope diario, timeouts, cancelación probada. Gasto del 2026-09-11: USD 0,64 con ~150 llamadas.
- Migraciones generadas con drizzle-kit, policies aparte, aplicadas en Docker y Neon.
