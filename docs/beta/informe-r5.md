# Informe de la tanda R5 (12/11)

Tanda R5, rumbo a la beta del 26/11 (ensayo con testers del 20 al 24/11). Cuatro agentes (rojo, catalogos, pantallas y qa) trabajaron en paralelo, cada uno en su worktree; el lead revisó, commiteó, pasó privacidad y abrió los PR. **Ningún PR se mergeó**: todos quedan en draft para Mauro.

## 1. PRs, en el orden de merge sugerido

| Orden | PR | Ticket | Carril | Antes de mergear |
|---|---|---|---|---|
| 1 | PR del e2e 124 (ver §6) | Arreglo del spec 124 del MCP | verde | Destraba el e2e de todos los demás PR |
| 2 | [#456](https://github.com/Malejo01/job-search-os/pull/456) | C6 · estados de carga | verde | — |
| 3 | [#455](https://github.com/Malejo01/job-search-os/pull/455) | C7 · /demo y pre-puntaje | verde | — |
| 4 | [#458](https://github.com/Malejo01/job-search-os/pull/458) | C9 · Perfil, anchos, Primeros pasos y glosario | verde | — |
| 5 | [#460](https://github.com/Malejo01/job-search-os/pull/460) | C11 · costos por usuario (doc) | verde | — |
| 6 | [#457](https://github.com/Malejo01/job-search-os/pull/457) | C3 · las 8 carreras en el pipeline | **rojo** | Aplicar 0061 y `rls/0012` en Neon (§4) |
| 7 | [#461](https://github.com/Malejo01/job-search-os/pull/461) | C8 · las 8 carreras primero en catálogos | rojo (apilado sobre C3) | Después de #457 |
| 8 | [#459](https://github.com/Malejo01/job-search-os/pull/459) | C10 · docs de la beta a 8 carreras | verde | Después de #457 y #461 (describe el selector final) |
| 9 | [#462](https://github.com/Malejo01/job-search-os/pull/462) | C12 · QA por carrera | verde | Después de #461: posible conflicto en `apps/web/e2e/personas/personas.ts` (líneas distintas) |
| 10 | este PR | C13 · cierre | verde | Al final |

Quedan afuera de la lista: `ronda/r5-c11-routing` (sin push, §5) y C5 (bloqueada, §5).

El check `carril` falla en todos los PR: son drafts sin la etiqueta `carril-verde` y los rojos fallan a propósito. No es un error.

## 2. Cómo se probó cada uno

| Ticket | Pruebas |
|---|---|
| C3 | Tests primero en pipeline (`relaciones-publicas.test.ts`); pipeline 4418 tests; lint y typecheck verdes; migración 0061 aplicada en la base local con `local.mjs migrate` (con las RLS); integración de db 434 de 434 tras ajustar un test de C1-2. Hallazgo de la QA (prefiltro de RR.PP.) arreglado con tests. e2e 44 y 41 los corre el CI. |
| C6 | Lint y typecheck verdes; e2e 125 nuevo (red lenta, sin saltos de layout, reducir movimiento) en el CI. |
| C7 | Lint y typecheck verdes; e2e 48 y 103 actualizados (CI: verdes salvo el 124, que no es de este PR). |
| C8 | Lint y typecheck verdes; pipeline 4411 tests; e2e 128 nuevo y 26, 41, 75 ajustados, en el CI. |
| C9 | Lint y typecheck verdes; e2e 113 y 127; el 38b y el 47 se ajustaron después del primer CI. |
| C10 | Lint (prettier); grep sin «6 carreras» en los archivos tocados. |
| C11 | Cada número con archivo:línea o supuesto marcado; tres escenarios de thinking porque no se mide leyendo código. |
| C12 | Prefiltro sin modelo de las 8 carreras (64 casos verdes); spec 126 corrido 4 veces contra la base local (la última: 27 pasaron, 5 fallaron, 16 no corrieron) y una vez sobre C3+C8 (RR.PP. 6 de 6). |

Todos: barrido de privacidad con veredicto PASA antes de cada push, y el pre-push sin hallazgos. En todos los worktrees fallan 3 tests de `privacy-scan.test.ts` por permisos de symlinks en Windows; en el CI pasan.

## 3. Qué quedó afuera

- **C5 (legales):** bloqueada hasta las respuestas legales 1, 2, 3 y 6.
- **`model_routing.json`:** commit local sin push (§5).
- **C6 y C9:** cuatro `loading.tsx` (Hoy, Ofertas, Perfil, Skills) hay que ajustarlos a los anchos de C9 después de mergear los dos.
- **C8:** los títulos de `/mercado/<carrera>`, `/ofertas/<carrera>` y «Carreras parecidas» siguen con la etiqueta vieja; el asistente sin carrera elegida ofrece palabras de tecnología (`alerts/portal-guide.ts`).
- **C3:** skills propias de RR.PP. (crisis, vocería, protocolo) necesitan `skills.json` y una migración de datos: ticket aparte. El caso `marketing_digital-04` del golden sintético es un aviso de RR.PP. y hay que moverlo a su JSON.
- **C9:** «Ser honesto con lo que no sabés» (`components/profile-form.tsx`) y el 👍/👎 de `packages/pipeline/src/first-steps.ts:104`.
- **C12:** evaluación con modelo real (no se pidió); el onboarding de contaduría, administración, marketing y programación no se pudo verificar en local (base sin seed): lo verifica el CI de #462.

## 4. Migraciones sin aplicar

| Migración | PR | Qué hace | Cuándo |
|---|---|---|---|
| `0061_carrera_relaciones_publicas.sql` | #457 | `waitlist_role_check` suma `relaciones_publicas` | Antes de mergear #457: /acceso empieza a guardar esa clave en la lista de espera |
| `rls/0012_cupos_fundador.sql` | #457 | `admin_founder_counts()` suma la clave | Junto con la 0061 |

## 5. Pasos manuales para Mauro, en orden

1. **Decidir el PR de `model_routing.json`** (`ronda/r5-c11-routing`, sin push). Toca `evals/`, así que cada push corre el job de evals pago con Sonnet 5.5: estimado USD 0,29 / 0,49 / 0,89 por push, con tope de 0,5. Opciones: (a) pushear tal cual; (b) fijar el modelo del job en `ci.yml` (Gemini, thinking `minimal`), que es carril rojo y lo editás vos; (c) dejarlo para después de la beta (la más conservadora; es la que queda si no decidís).
2. **Mergear los verdes** en el orden de §1, después de revisar cada uno.
3. **Aplicar la 0061 y `rls/0012` en Neon** desde la rama de #457, después de revisar el SQL, y recién ahí mergear #457.
4. **Después del deploy de C3:** correr `pool:rehint` para que los avisos de RR.PP. ya guardados pasen de marketing a la carrera nueva.
5. **Mergear #461, #459 y #462**, en ese orden.
6. **Pedirle a catalogos el retoque de anchos** de los cuatro `loading.tsx`.
7. **Responder las preguntas legales 1, 2, 3 y 6** (`docs/legal/preguntas-ani.md`) para destrabar C5.
8. **Costos:** actualizar la cotización (el doc usa oficial venta 1.570 del 6/11), medir con `pnpm llm:spend` cuánto razona Sonnet en `low` y revisar `LLM_DAILY_CAP_USD` en Vercel: con 25 usuarios el gasto medio estimado (USD 4,4 por día) pasa el 4 que sugiere el runbook.
9. **Decisiones de producto:** el cierre de /demo dice «Pedir acceso» como el guion del video, y la auditoría pide «Anotarme a la beta»; marketing se rotula «Marketing digital» en `role_skills.json`, que también lee el evaluador como puesto objetivo («Marketing», si preferís, es una línea).
10. **Confirmar el P1 de criterios** con modelo real (§7).

## 6. CI: el e2e 124 del MCP

El e2e `124-mcp-tokens-personales.spec.ts:196` falla en todos los PR (recibe 200 donde espera 401). El diagnóstico de seguridad dice que **no es un problema de acceso**: el servidor de e2e declara tester a la persona B (`apps/web/playwright.config.ts:54-56`, desde R4-15) y el spec supone que no lo es. El gate falla cerrado (`apps/web/lib/mcp-user.ts:52`, `packages/pipeline/src/agent/gate.ts:41-42`). El arreglo usa en el spec una tercera persona que no es tester ni admin.

## 7. Hallazgos de QA, priorizados

Detalle y capturas en `docs/beta/qa-carreras/` (README y un informe por carrera).

- **P0:** ninguno confirmado.
- **P1 · criterios sin carrera (puede subir a P0):** los criterios de todo usuario nuevo salen de `DEFAULT_CRITERIA_RULES` sin mirar la carrera (`packages/pipeline/src/onboarding.ts:115-124`) y `DISCIPLINES` (`packages/pipeline/src/evaluation.ts:30-36`) no tiene disciplina para abogacía, contaduría, comunicación, RR.II. ni RR.PP. Una persona de RR.II. ve «Puesto de ai engineer» y disciplinas técnicas en «Tenés (de tu perfil)». **Confirmar con modelo real si el bloqueador de disciplina (`decide.ts:199-205`) frena avisos de carreras no tech: si los frena, es P0 antes de la beta** (carril rojo: decide y evaluación).
- **P1 · prefiltro de RR.PP.:** «Community manager» y similares se descartaban para RR.PP. **Arreglado en #457.**
- **P2 · ayuda:** la FAQ «¿Necesito conocimientos técnicos…?» dice «sin jerga técnica» y «ciencias sociales, económicas y jurídicas», y programación ya es carrera de la beta (`apps/web/app/(public)/ayuda/page.tsx`).
- **P2 · /hoy:** «Elegir tus áreas» figura sin hacer justo después del onboarding.
- **P2 · abogacía:** «Negociación y cierre de ventas» aparece entre las skills del puesto.
- **Resuelto en #457:** el chip de RR.PP. de /acceso guardaba `marketing_digital`.
- **No concluyente en local:** el paso de skills del onboarding de contaduría, administración, marketing y programación (base local sin seed); lo verifica el CI de #462.
