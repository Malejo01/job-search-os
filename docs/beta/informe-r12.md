# Informe de la tanda R12 «Coach de CV» (17/11)

> **Estado: parcial.** Este primer push es el **aviso temprano** para la integración de la prueba de Ani
> del 20/11. El informe completo (Fase 2, gasto de evals y lo que quedó abierto) se completa al cerrar la tanda.

Base de todas las ramas: `origin/ronda/integracion-r11` (PR #517). Ningún PR se mergeó.

## Aviso temprano: integración parcial para la prueba de Ani (20/11)

Fase 1 completa, más R12-12 (PDF), R12-16 (test intermitente) y la guía de Ani. Las ramas van en este orden
de merge sobre `ronda/integracion-r11`:

| Orden | Rama | PR | Ticket | Carril | Notas |
|---|---|---|---|---|---|
| 1 | `ronda/r12-16-lectura-concurrente` | [#519](https://github.com/Malejo01/job-search-os/pull/519) | R12-16 · carrera real en el cupo de lecturas | rojo | Destraba el job `integration` del CI |
| 2 | `ronda/r12-4-proyectos` | [#522](https://github.com/Malejo01/job-search-os/pull/522) | R12-4 · Proyectos en `career_history` y en el CV | rojo | **Migración 0066** (abajo) |
| 3 | `ronda/r12-2-multicampo` | [#520](https://github.com/Malejo01/job-search-os/pull/520) | R12-2 · extracción multi-campo, `cv_interview@v3` | rojo | **Un conflicto** en `apps/web/lib/cv-chat-server.ts`: quedarse con la línea de R12-4 (`link: e.link ?? null,`) |
| 4 | `ronda/r12-3-acuse` | [#526](https://github.com/Malejo01/job-search-os/pull/526) | R12-3 · acuse con lo entendido y «¿Cuál dejo?» | verde | Sale de R12-2 |
| 5 | `ronda/r12-6-puerta-cv` | [#528](https://github.com/Malejo01/job-search-os/pull/528) | R12-6 · puerta «Tengo CV / No tengo CV» | rojo | e2e renumerado a 142 |
| 6 | `ronda/r12-12-pdf` | [#521](https://github.com/Malejo01/job-search-os/pull/521) | R12-12 · PDF con `pdfjs-dist@6.5.438` | rojo | Dependencia nueva |
| 7 | `ronda/r12-14-prueba-ani` | [#524](https://github.com/Malejo01/job-search-os/pull/524) | R12-14 · guía de la prueba de Ani | verde | Solo docs |

Opcional para el 20/11: `ronda/r12-5-lectura-vinetas` ([#527](https://github.com/Malejo01/job-search-os/pull/527), rojo, prompt `extract_cv_profile@v2`): las tarjetas de la lectura traen las viñetas «de tu CV» y una tarjeta de proyectos. Sale de R12-4 y mergea el contrato R12-7 (`ronda/r12-7-contrato-coach`, [#518](https://github.com/Malejo01/job-search-os/pull/518)), así que suma las dos.

**Probado por el lead (17/11, en local, sin empujar):** la mezcla de las 7 ramas en ese orden sobre `ronda/integracion-r11` tiene un solo conflicto (el de arriba). `pnpm lint`, `pnpm typecheck` y `pnpm test` dan verde (pipeline 5196, adapters 1155, web 15, db 149, evals 119, prompts 27). En una base limpia con la migración 0066, la integración de `career_history` (7/7) y de `profile-agent`, `cv-chat` y `cv` (75/75) también da verde. Los e2e quedan para el CI.

### Pasos manuales para Mauro antes del 20/11
1. **Migración de Proyectos** (R12-4), con `pnpm db:migrate` después de revisar el SQL. La RLS de `career_history` (rls/0014, `FOR ALL` por fila) cubre la columna nueva:
   ```sql
   ALTER TABLE "career_history" DROP CONSTRAINT "career_history_kind";
   ALTER TABLE "career_history" ADD COLUMN "link" text;
   ALTER TABLE "career_history" ADD CONSTRAINT "career_history_link" CHECK ("career_history"."link" is null or ("career_history"."link" ~ '^https://' and char_length("career_history"."link") <= 200));
   ALTER TABLE "career_history" ADD CONSTRAINT "career_history_kind" CHECK ("career_history"."kind" in ('trabajo', 'educacion', 'certificacion', 'proyecto'));
   ```
2. **Vercel:** dejar `CV_IMPORT_ENABLED=1` y `CV_PROFILE_AGENT=testers`. `CV_COACH` no se define (apagado).
3. **Cuentas de Ani:** tres cuentas de prueba, una por CV inventado, en `ASSISTANT_TESTER_EMAILS` (guía en `docs/beta/coach-cv-prueba.md`).
4. Correr `pnpm secrets:scan` y el barrido de privacidad: no corrieron en la sesión de la nube (sin Docker ni `fixtures-private/`).

### Línea de base (transcripción del 17/11, sin modelo, respuestas grabadas)
| | Datos perdidos | Preguntas repetidas |
|---|---|---|
| Antes (`ronda/integracion-r11`) | 5/18 (27,8 %): los 4 proyectos y la segunda opción de puesto | 3/12 (25 %): cargo, fechas y tareas |
| Después de R12-2 | 0/18 | 0/10 |
| Después de R12-3 | 0/18 | 0/11 (más 1 «¿Cuál dejo?» por el cargo dicho de dos formas) |

**Cautela:** las respuestas del modelo con el esquema nuevo las escribió el mismo agente que hizo el cambio. Los números miden que el código aprovecha lo que el modelo devuelve, no que el modelo lo devuelva. La confirmación es la prueba de Ani y la corrida con el modelo real de la Fase 3.
