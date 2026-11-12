# QA relaciones públicas

Persona: Rocío Ficticia (`rocio`). Capturas: `rocio-acceso-390|1280.png`.

- **/acceso (P2, conocido, lo arregla C3):** el chip «Relaciones públicas» se elige y se ve marcado, pero guarda `marketing_digital` en vez de `relaciones_publicas`. Archivo: `apps/web/app/(public)/acceso/page.tsx:37`. La prueba falló por eso y, al estar en serie, no corrió el resto.
- Registro, onboarding, ofertas, /hoy, /jobs, detalle, Perfil, CV y ayuda: sin verificar en local. El spec ahora separa /acceso del recorrido; en main el puesto del onboarding es «Marketing y relaciones públicas».
- Prefiltro sobre 6 avisos sintéticos (`relaciones_publicas.json`) con la clave `marketing_digital`: verde, sin hallazgos.

## Parte 2 (sobre C3+C8)

Rama local `ronda/r5-c8-catalogos` (incluye C3), que no se pushea. Spec 126 filtrado a RR.PP.: **6 de 6 en verde** (1,4 min): /acceso con el chip, registro, onboarding, /hoy, /jobs, detalle, Perfil, CV y ayuda. Las capturas de esa corrida quedaron en `apps/web/test-results/` de la carpeta principal y no las revisé una por una (ya no estaban cuando intenté abrirlas), así que no hay observaciones visuales de esta pasada.

- **/acceso:** el chip guarda `relaciones_publicas` (`apps/web/app/(public)/acceso/page.tsx`). Resuelto el hallazgo de la parte 1.
- **P1 · prefiltro (en arreglo en #457):** `ROLE_OWN_TITLE_PHRASES.relaciones_publicas` (`packages/pipeline/src/prefilter/prefilter.ts:163`) solo libera «pr manager», «public relations manager» y «communications manager». Un aviso «Community manager» o «Social media manager» se descarta con `titulo_blocklist` («'manager' en el título») para quien eligió RR.PP., y para Marketing llega (`prefilter.ts:153-161`). Caso: `relaciones_publicas-04`, marcado `it.fails` en `packages/pipeline/src/golden-carreras-r5.test.ts`; cuando se arregle ese test avisa y hay que sacarle el `it.fails`.
- **Golden de marketing, `marketing_digital-04` («Ejecutivo/a de relaciones públicas»):** C3 lo evalúa contra RR.PP. con un parche en `golden-carreras-prefiltro.test.ts` (`MOVED_TO_RRPP`). El JSON de marketing no es de qa: conviene moverlo a `relaciones_publicas.json` cuando se pueda.
- Para quien eligió Marketing, los avisos de RR.PP. ya no llegan (separación esperada, ADR-033).
- El prefiltro de los 6 avisos sintéticos corre con la clave propia: 5 en verde y el caso anterior como fallo esperado.
- Sigue en pie el P1 de criterios (README): C3 no cambió `criteriaFromOnboarding` ni `DISCIPLINES`, y RR.PP. tampoco tiene disciplina propia.
