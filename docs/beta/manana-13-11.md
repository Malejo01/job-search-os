# Mañana 13/11: qué mergear y qué decidir

Una página con todo lo que quedó abierto de las tandas R5, R6 y R7 (12 y 13/11). Ningún PR está mergeado. El detalle está en `informe-r5.md`, `informe-r6.md` e `informe-r7.md`.

## 1. PRs abiertos, en el orden de merge sugerido

| # | PR | Ticket | Carril | Depende de | Migración |
|---|---|---|---|---|---|
| 1 | #463 | R5 · arreglo del e2e 124 | verde | — | — |
| 2 | #456 | R5-C6 · estados de carga | verde | — | — |
| 3 | #455 | R5-C7 · /demo | verde | — | — |
| 4 | #458 | R5-C9 · Perfil, anchos y glosario | verde | — | — |
| 5 | #460 | R5-C11 · costos por usuario (doc) | verde | — | — |
| 6 | #457 | R5-C3 · las 8 carreras en el pipeline | **rojo** | — | **0061 + `rls/0012`** |
| 7 | #461 | R5-C8 · catálogos a 8 carreras | rojo (base) | #457 | — |
| 8 | #459 | R5-C10 · docs a 8 carreras | verde | #457, #461 | — |
| 9 | #462 | R5-C12 · QA por carrera | verde | #461 | — |
| 10 | #465 | R6-1 · «+ Cargar oferta» visible | verde | #458 | — |
| 11 | #467 | R6-6 · anchos de los `loading.tsx` | verde | #456, #458 | — |
| 12 | #466 | R6-4 · textos que quedaron de la R5 | rojo (base) | #461 | — |
| 13 | #468 | R6-2 · criterios por carrera | **rojo** | #457 | **0062** |
| 14 | #469 | R6-5 · skills de RR.PP. | **rojo** | #468 | **0063** (datos) |
| 15 | #476 | R7-7 · kit del ensayo | verde | — | — |
| 16 | #475 | R7-5 · accesibilidad con axe | verde | — | — |
| 17 | #471 | R7-3 · tope del asistente | rojo | — | — |
| 18 | #473 | R7-6 · pantallas lentas | verde | #458, #465 (mismo `jobs/page.tsx`) | — |
| 19 | #474 | R7-4 · auditoría de seguridad | rojo | — | — |
| 20 | #472 | R7-1 · alertas de presupuesto | rojo | — | — |
| 21 | #R72 | R7-2 · no reevaluar duplicados | rojo | — | — |
| 22 | #464 | R5 · cierre | verde | todo lo de la R5 | — |
| 23 | #470 | R6 · cierre | verde | #464 | — |
| 24 | #R7C | R7 · cierre (este) | verde | #470 | — |

Fuera de la lista, sin PR:
- `ronda/r6-3-imagen` (R6-3, oferta desde una imagen): está pusheada, pero el PR no se abrió porque toca `packages/prompts/` y el CI correría evals pagos. Decisión 2.
- `ronda/r5-c11-routing`: es local, sin push, porque toca `evals/`. Decisión 3.

**Migraciones en Neon**, antes de mergear #457:
- Desde la rama `ronda/r6-5-skills-rrpp`, después de revisar el SQL, corré `pnpm db:migrate` (pide `si`).
- Aplica en orden la 0061, la 0062, la 0063 y después `rls/0012`.
- Las tres son seguras de aplicar antes del merge: suman un valor a un check, valores a un enum y 4 skills idempotentes.

## 2. PR de integración: no se armó

El pedido era una rama `ronda/integracion-r5-r7` con `git merge --no-ff` de cada rama, para un solo build. **El guard bloquea `git merge` para los agentes** (CLAUDE.local.md §3.14) y no se buscó otro camino. Si querés el PR único, corrélo vos con `!`, en este orden:

```bash
git fetch origin
git switch -c ronda/integracion-r5-r7 origin/main
git merge --no-ff origin/ronda/r5-e2e124
git merge --no-ff origin/ronda/r5-c6-cargas
git merge --no-ff origin/ronda/r5-c7-demo
git merge --no-ff origin/ronda/r5-c9-perfil
git merge --no-ff origin/ronda/r5-c11-costos
git merge --no-ff origin/ronda/r5-c3-carreras
git merge --no-ff origin/ronda/r5-c8-catalogos
git merge --no-ff origin/ronda/r5-c10-docs
git merge --no-ff origin/ronda/r5-c12-qa-carreras
git merge --no-ff origin/ronda/r6-1-cargar-oferta
git merge --no-ff origin/ronda/r6-6-anchos-carga
git merge --no-ff origin/ronda/r6-4-textos
git merge --no-ff origin/ronda/r6-2-criterios
git merge --no-ff origin/ronda/r6-5-skills-rrpp
git merge --no-ff origin/ronda/r7-7-kit-ensayo
git merge --no-ff origin/ronda/r7-5-accesibilidad
git merge --no-ff origin/ronda/r7-3-asistente-tope
git merge --no-ff origin/ronda/r7-6-pantallas-lentas
git merge --no-ff origin/ronda/r7-4-auditoria-seguridad
git merge --no-ff origin/ronda/r7-1-alertas-gasto
git merge --no-ff origin/ronda/r7-2-no-reevaluar
git merge --no-ff origin/ronda/r7-cierre
```

`ronda/r7-cierre` ya trae los cierres de la R5 y la R6. La integración no incluye R6-3 ni el routing de la R5, así que no dispara los evals pagos.

**Choques previstos** (archivos que tocan dos ramas que no se contienen):
- **`packages/pipeline/test/fixtures/carreras/relaciones_publicas.json` y `README.md`, entre #462 y #469:** las dos crean el JSON. Hay que juntar los casos de las dos y, si se repite un id (`relaciones_publicas-04`), renumerar el de #469. El test de conteo de #469 (`golden-carreras-c8.test.ts`) puede necesitar el total nuevo.
- **`apps/web/app/(app)/jobs/page.tsx`, entre #458 + #465 y #473:** C9 y R6-1 cambian la cabecera y la lista; R7-6 pasa las consultas a `Promise.all`. Hay que quedarse con el JSX de R6-1 y las consultas de R7-6.
- **`apps/web/app/(app)/settings/page.tsx`, entre #458 y #473:** lo mismo.
- **Probables sin choque,** porque son líneas distintas: `ayuda/page.tsx` (#458 y #466), `e2e/personas/personas.ts` (#461 y #462) y `skills/self-assessment.ts` (#461 y #468).

Después: `pnpm lint && pnpm typecheck && pnpm test`, el último commit con `[preview]`, y el PR en draft con «Create a merge commit» al mergear, así GitHub marca solos los PR individuales.

## 3. Decisiones que esperan a Mauro

1. **Integración:** correr el §2 o mergear los PR uno por uno.
2. **R6-3 (imagen):** abrir el PR aceptando unos USD 0,16 por push de evals (`informe-r6.md` §5), o dejarlo para después de la beta. Si se mergea: la fila de `model_routing` (`pasos-manuales-r6.md` §1) y revisar si los textos legales cubren que la imagen viaje al proveedor.
3. **`model_routing.json` de la R5:** pushear (evals pagos de unos USD 0,3 a 0,9 por push), fijar Gemini en `ci.yml` o dejarlo para después de la beta (`informe-r5.md` §5).
4. **Legales:** las respuestas 1, 2, 3 y 6 de `docs/legal/preguntas-ani.md`, que destraban C5.
5. **Costos:**
   - actualizar la cotización;
   - medir el thinking con `pnpm llm:spend`;
   - revisar `LLM_DAILY_CAP_USD`: con 25 usuarios el gasto medio pasa el tope de 4.
6. **Vercel (R7-1):** `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_EMAILS` y `LLM_DAILY_CAP_USD`.
7. **Seguridad (R7-4):**
   - `! pnpm secrets:scan`;
   - verificar HSTS en producción;
   - confirmar que la regla de firewall del login siga activa.
8. **Producto:**
   - «Pedir acceso» o «Anotarme a la beta» en /demo;
   - «Marketing digital» o «Marketing»;
   - las listas de disciplinas por carrera de R6-2 (`CAREER_DISCIPLINES`).
9. **Pool de conexiones (R7-6):** medir en la preview y, si hay espera, subir `max` en `apps/web/lib/db.ts`.
10. **Después del deploy de C3:** correr `pool:rehint`.
11. **Ensayo:** ajustar los criterios de `docs/beta/ensayo/decision-25-11.md` antes del 23/11.
12. **Worktrees:**
    - `! git worktree remove --force C:/wt/jso-catalogos`, y lo mismo con `jso-pantallas` y `jso-qa`;
    - si falla: `! cmd /c rmdir /s /q "\\?\C:\wt\jso-qa"` y después `! git worktree prune`;
    - `jso-rojo` queda para C5.
