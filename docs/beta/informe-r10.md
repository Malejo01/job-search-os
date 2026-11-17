# Informe de la tanda R10 «Agente de perfil desde el CV» (13/11)

Cinco teammates en su carpeta: diseno, lectura, charla y cierre, con diseno primero. El contrato es el ADR-034 (`docs/adr/034-agente-de-perfil-desde-el-cv.md`). Cada PR pasó la revisión de privacidad y una de seguridad hecha por otro agente. **Ningún PR se mergeó.** Todo queda detrás del flag `CV_PROFILE_AGENT`, que vale `apagado` por defecto: sin la variable, la app queda igual que hoy.

## 1. PRs, en el orden de merge

Todos se apilan sobre R10-0. Como cada PR se abre contra `main`, su diff incluye los commits de la rama de la que sale.

| Orden | PR | Ticket | Rama | Sale de |
|---|---|---|---|---|
| 1 | [#497](https://github.com/Malejo01/job-search-os/pull/497) | R10-0 · ADR-034 y contrato | `ronda/r10-0-adr-agente-perfil-v2` | `main` |
| 2 | [#500](https://github.com/Malejo01/job-search-os/pull/500) | R10-1 · subir el CV | `ronda/r10-1-subir-cv` | R10-0 |
| 3 | [#503](https://github.com/Malejo01/job-search-os/pull/503) | R10-2 · tarjetas por sección | `ronda/r10-2-tarjetas` | R10-1 |
| 4 | [#499](https://github.com/Malejo01/job-search-os/pull/499) | R10-3 · charla de huecos | `ronda/r10-3-huecos` | R10-0 |
| 5 | [#502](https://github.com/Malejo01/job-search-os/pull/502) | R10-4 · guía de búsqueda | `ronda/r10-4-guia` | R10-3 |
| 6 | [#498](https://github.com/Malejo01/job-search-os/pull/498) | R10-5 · cierre con CV para ATS y onboarding | `ronda/r10-5-cierre-onboarding` | R10-0 |
| 7 | [#501](https://github.com/Malejo01/job-search-os/pull/501) | R10-6 · pruebas y lista para Ani | `ronda/r10-6-pruebas` | R10-5 |
| 8 | este PR | cierre de la R10 | `ronda/r10-cierre` | `ronda/r9-cierre` |

- **El cuerpo del #498 no dice «depende de #497»:** el guard bloquea `gh pr edit` y `gh pr comment`. Los demás PR sí lo dicen en la primera línea.
- **Ninguna migración.** El cupo usa la fila marcador `profile_read` en `llm_calls`.
- **Ramas para la integración**, en este orden y después de las de la R8 y la R9: la columna «Rama» de arriba, de la fila 1 a la 8. La rama vieja `ronda/r10-0-adr-agente-perfil` quedó local y sin uso: tenía datos de ejemplo que marcó el barrido de privacidad.

**Al integrar.** Las tres etapas se escribieron en paralelo. Hay cosas duplicadas o que hay que conectar:
- **Lectura del flag:** cada etapa tiene la suya (`profileAgentEnabledFor` en `close-server.ts`, `profileAgentAllowedFor` en `gaps-server.ts` y la de `read-server.ts`). Conviene unificarlas.
- **Medición de gasto:** `measureGaps` y la de la lectura se repiten en parte.
- **Claves de `sessionStorage`:** el cierre lee `jso:pa:ticket`, `jso:pa:state` y `jso:pa:summary`. Nadie escribe `jso:pa:summary` todavía: el cierre tiene que derivar el resumen de la base o la lectura tiene que escribirlo.
- **Enlaces entre etapas:** «Seguir» de las tarjetas apunta a `/cv/perfil/huecos`, que existe en #499. La guía acepta un `suggestedRoles` que la lectura todavía no manda.
- **`extraction.test.ts`:** #500 y #503 tienen el mismo cambio (un email de ejemplo en lugar de un teléfono partido), así que no choca.
- **El e2e del recorrido completo** (subir → tarjetas → huecos → guía → CV) está escrito como guion en `docs/beta/agente-perfil-pruebas.md` §6. Se implementa en la rama de integración, con el número 135.

## 2. Cómo se probó

- **Pipeline:** tests primero en cada etapa. Al cierre hay unos 4.780 tests en verde por rama, con más de 250 nuevos del agente.
- **Integración con Postgres real (Docker local):** 20 tests de la lectura, 10 de las tarjetas, 14 de los huecos y 11 del cierre. Cubren RLS, cupo, topes con filas de costo null, lecturas y turnos en paralelo y el marcador.
- **e2e:** el 134 cubre el agente apagado (404 sin el flag y onboarding igual que hoy). El resto de los e2e los corre el CI.
- **Seguridad:** una revisión por PR, hecha por otro agente, con todas las observaciones medias corregidas. Las que se corrigieron en el camino:
  - R10-0: O1 a O7 (gasto con las fallidas, variantes de sensibles, slug contra la taxonomía, orden sesión → flag → ticket → tope);
  - R10-3 y R10-4: O-A (turnos con reservas vivas) y O-B (`$&` en las plantillas);
  - R10-4: la evidencia de las skills se recalcula en el servidor;
  - R10-5: el resumen pasa el filtro y un fallo de redacción cuenta.

  Las bajas que quedan están en el cuerpo de cada PR.
- **Privacidad:** PASA en todos.
  - **R10-0** se rehízo como `-v2`: el primer commit tenía ejemplos de DNI, domicilio y teléfono que coincidían con patrones privados.
  - **Los casos «DNI» o «CUIL» con dígitos** quedaron sin test, porque el barrido los marca aun con valores inventados. No se esquivó.
- **Estado del CI al cierre:**
  - el check `secrets` (gitleaks) falla en todos los PR de la R10 (§4, punto 1);
  - el e2e de varios PR seguía en cola;
  - `carril` falla a propósito: ningún PR lleva `carril-verde`.

## 3. Gasto de evals (tope USD 5)

| Qué | USD |
|---|---|
| #499 (R10-3), al abrirse con `profile_gaps.v1.md` | ~0,16 |
| #500 (R10-1), al abrirse con `extract_cv_profile.v1.md` | ~0,16 |
| #502 (R10-4): su diff contra `main` trae el prompt de R10-3 | ~0,16 |
| #503 (R10-2): su diff contra `main` trae el prompt de R10-1 | ~0,16 |
| **Total** | **~0,64** (estimado; el CI no informa el monto exacto). Sin llamadas reales al modelo |

## 4. Pasos manuales para el dueño del proyecto

1. **Gitleaks en todos los PR de la R10.**
   - **Qué pasa:** el check `secrets` falla por `const SECRET = "secreto-de-prueba-0123456789"` en `packages/adapters/src/profile-agent/ticket.test.ts:6` (commit fe37292, regla `generic-api-key`). Es un valor de prueba evidente, marcado por la entropía de los dígitos (en `main`, el test del ticket del chat de CV usa `secreto-de-prueba` y pasa).
   - **Por qué no se arregló con un commit:** como está en la historia de R10-0 y todo se apila encima, un commit nuevo no lo saca.
   - **Opciones:**
     - (a) **recomendada:** agregar un `.gitleaksignore` con la huella `fe372929ac96fa5a77c0e42c42696a6a29113c4f:packages/adapters/src/profile-agent/ticket.test.ts:generic-api-key:6`;
     - (b) rehacer R10-0 y las 6 ramas de arriba.
   
     El lead no cambió la configuración de un control de seguridad.
2. **Neon, fila `extract_cv_profile` de `model_routing`.** El SQL, con su guarda y la verificación en la misma transacción, está en el cuerpo de #500. Sin la fila, la lectura falla cerrado.
3. **Vercel:** `CV_IMPORT_ENABLED=1` y `CV_PROFILE_AGENT=testers` cuando quieras habilitarlo para testers. Es opcional: `CV_PROFILE_AGENT_DAILY_CAP_USD`, que por defecto vale USD 1.
4. **`pdfjs-dist`: sí o no.** Es una dependencia nueva (ADR-034 §11). Sin ella, el PDF muestra «Pegá el texto de tu CV»; el DOCX y el texto pegado funcionan.
5. **Política de privacidad:** el texto del CV, ya filtrado, y las respuestas viajan a Google o a Anthropic. Tiene que figurar antes de pasar el flag a `all`.
6. **Lista para Ani:** `docs/beta/agente-perfil-pruebas.md` (#501), con el tono, las preguntas por carrera, lo que no debe preguntar y el CV resultante. El costo estimado es de unos USD 0,08 por charla típica, con un tope duro de USD 0,30.

## 5. Qué quedó afuera y observaciones

- **No hubo una corrida real con el modelo:** no se midió el costo real por charla.
- **R10-1:**
  - recargar la página antes de guardar las tarjetas obliga a leer de nuevo, y eso consume cupo;
  - un `.docx` que en realidad es PDF recibe el mensaje del PDF.
- **R10-4:**
  - `plan:build` puede borrar una skill sumada desde la guía; hay que revisarlo antes de pasar a `all`;
  - criterios y perfil se guardan en dos transacciones.
- **R10-5:**
  - un error real de redacción no se puede reintentar en la misma charla (cuenta como intento);
  - el tope por persona y día se mide fuera del lock;
  - `/onboarding/skills` sigue con `requireUserId`, igual que antes.
- **Datos de ejemplo partidos en `main`:** `packages/pipeline/src/cv/extraction.test.ts` trae «D» + «NI», «CU» + «IL» y un teléfono armados así para esquivar el barrido. Es de antes de esta tanda. R10-1 había copiado el truco y se corrigió; los de `main` siguen.
- **El ADR-034 (§1) pone las plantillas de preguntas en `packages/prompts/`,** como se pidió, pero el modelo no las redacta (ADR-026 §3).

## 6. Necesito de vos

1. Gitleaks: (a) `.gitleaksignore` o (b) rehacer las ramas (§4, punto 1).
2. `pdfjs-dist`: sí o no.
3. ¿Se reescriben sin partir los ejemplos de `extraction.test.ts` de `main`? ¿Se afinan los patrones #131 y #132 para que un «DNI» o «CUIL» inventado se pueda testear?
4. Antes de pasar el flag a `all`: el texto legal y la revisión de `plan:build`.
