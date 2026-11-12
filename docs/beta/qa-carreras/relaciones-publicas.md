# QA relaciones públicas

Persona: Rocío Ficticia (`rocio`). Capturas: `rocio-acceso-390|1280.png`.

- **/acceso (P2, conocido, lo arregla C3):** el chip «Relaciones públicas» se elige y se ve marcado, pero guarda `marketing_digital` en vez de `relaciones_publicas`. Archivo: `apps/web/app/(public)/acceso/page.tsx:37`. La prueba falló por eso y, al estar en serie, no corrió el resto.
- Registro, onboarding, ofertas, /hoy, /jobs, detalle, Perfil, CV y ayuda: sin verificar en local. El spec ahora separa /acceso del recorrido; en main el puesto del onboarding es «Marketing y relaciones públicas».
- Prefiltro sobre 6 avisos sintéticos (`relaciones_publicas.json`) con la clave `marketing_digital`: verde, sin hallazgos.

## Parte 2 (sobre C3+C8)

Rama local `ronda/r5-c8-catalogos` (incluye C3), que no se pushea. Spec 126 filtrado a RR.PP.: **6 de 6 en verde** (1,4 min): /acceso con el chip, registro, onboarding, /hoy, /jobs, detalle, Perfil, CV y ayuda. Las capturas de esa corrida quedaron en `apps/web/test-results/` de la carpeta principal y no las revisé una por una (ya no estaban cuando intenté abrirlas), así que no hay observaciones visuales de esta pasada.

- **/acceso:** el chip guarda `relaciones_publicas` (`apps/web/app/(public)/acceso/page.tsx`). Resuelto el hallazgo de la parte 1.
- **P1 · prefiltro (arreglado en #457, ccc3318):** `ROLE_OWN_TITLE_PHRASES.relaciones_publicas` (`packages/pipeline/src/prefilter/prefilter.ts:163`) solo liberaba «pr manager», «public relations manager» y «communications manager». Un aviso «Community manager» o «Social media manager» se descartaba con `titulo_blocklist` («'manager' en el título») para quien eligió RR.PP., y para Marketing llegaba (`prefilter.ts:153-161`). Ahora libera community manager, social media manager, brand manager, assistant brand manager, public affairs manager, event manager y events manager, con tests. Verificado con el caso `relaciones_publicas-04` en la rama local de la parte 2, donde estaba como fallo esperado antes del arreglo.
- **Golden de marketing, `marketing_digital-04` («Ejecutivo/a de relaciones públicas»):** C3 lo evalúa contra RR.PP. con un parche en `golden-carreras-prefiltro.test.ts` (`MOVED_TO_RRPP`). El JSON de marketing no es de qa: conviene moverlo a `relaciones_publicas.json` cuando se pueda.
- Para quien eligió Marketing, los avisos de RR.PP. ya no llegan (separación esperada, ADR-033).
- El prefiltro de los 6 avisos sintéticos corría con la clave propia: 5 en verde y `relaciones_publicas-04` como fallo esperado, que el arreglo de #457 resuelve.
- Sigue en pie el P1 de criterios (README): C3 no cambió `criteriaFromOnboarding` ni `DISCIPLINES`, y RR.PP. tampoco tiene disciplina propia.
