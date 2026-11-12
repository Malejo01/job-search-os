# QA por carrera sobre main (C12, parte 1)

Fecha: 12/11/2026. Todo con datos ficticios. Recorrido hecho por el spec 126 (Playwright) contra la base local con LLM demo (sin costo); capturas a 390 y 1280 px en `apps/web/test-results/` de la carpeta principal (no versionado).

## Qué se cubrió

- Prefiltro y encaje por título, sin modelo: `packages/pipeline/src/golden-carreras-r5.test.ts` (8 carreras, 64 casos, verdes).
- Recorrido en vivo con la cuarta corrida del spec (27 pasaron, 5 fallaron, 16 no corrieron, 3,9 min); la tabla es de lo que se vio en las corridas 3 y 4:

| Carrera | /acceso | Registro y paso 1 | Skills | Ofertas, /hoy, /jobs, detalle | Perfil, CV, ayuda |
| --- | --- | --- | --- | --- | --- |
| Abogacía | ok | ok | ok | ok | ok |
| Comunicación | ok | ok | ok | ok | ok |
| Rel. internacionales | ok | ok | ok | ok (hallazgo P1) | ok |
| Contaduría | ok | ok | falló (ver abajo) | sin verificar | sin verificar |
| Administración | ok | ok | falló (ver abajo) | sin verificar | sin verificar |
| Marketing | ok | ok | falló (ver abajo) | sin verificar | sin verificar |
| Programación | ok | ok | falló (ver abajo) | sin verificar | sin verificar |
| Relaciones públicas | falló (conocido) | sin verificar | sin verificar | sin verificar | sin verificar |

## Hallazgos

### P0
Ninguno.

### P1
1. **Rel. internacionales, /hoy y detalle de oferta: el requisito dice «Puesto de ai engineer».** La persona eligió Relaciones internacionales y la oferta es de su carrera, pero la tarjeta de /hoy y el detalle comparan contra «ai engineer» y listan «Tenés (de tu perfil): ai engineer, ml engineer, ai, evaluation, creative production, fullstack, frontend, backend, devops, data, ciberseguridad, negocio, project management, administ…» (capturas `ines-hoy-390`, `ines-detalle-390`). **Evidencia de que no es del spec:** la persona sí carga su carrera (`apps/web/e2e/personas/flow.ts:217` verifica en la base `targetRoles == [relaciones_internacionales]`). El lado «Tenés (de tu perfil)» es de la app: los criterios de cada usuario nuevo se arman con `criteriaFromOnboarding`, que copia `DEFAULT_CRITERIA_RULES` y solo cambia salario y horas, sin mirar la carrera (`packages/pipeline/src/onboarding.ts:115-124`, usado en `apps/web/lib/onboarding.ts:346-355`). Esa lista (disciplinas técnicas y de negocio) es la que `decide()` usa para el bloqueador «disciplina distinta» (`packages/pipeline/src/decide.ts:199-205`) y `checklist.ts:217-231` para mostrar el requisito. Además `DISCIPLINES` (`packages/pipeline/src/evaluation.ts:30-36`) no tiene disciplina propia para abogacía, contaduría, comunicación ni relaciones internacionales. El lado «Puesto de ai engineer» sale de la evaluación demo (`ev.disciplina`, `checklist.ts:224`), así que ese texto concreto puede ser del demo; **confirmar con el modelo real o en el CI qué disciplina asigna a un aviso de estas carreras y si el bloqueador de disciplina se dispara**. C3 (rojo) no tocó `criteriaFromOnboarding` ni `DISCIPLINES` según el lead; verificarlo en la parte 2.

   **A confirmar con modelo real o en producción si el bloqueador de disciplina frena avisos de carreras no tech; si los frena, sube a P0.**

### P2
1. **Ayuda: «¿Necesito conocimientos técnicos o saber de programación?» contradice a Programación como carrera de la beta.** Dice que la app es «para profesionales y estudiantes de ciencias sociales, económicas y jurídicas» y «sin jerga técnica», y arriba lista Programación entre las 8 carreras (`ines-ayuda-1280`). Archivo probable: `apps/web/app/(public)/ayuda/page.tsx`.
2. **/acceso, chip «Relaciones públicas» guarda `marketing_digital`** en main (conocido, lo arregla C3). Archivo: `apps/web/app/(public)/acceso/page.tsx:37`. Programación guarda `fullstack` (decisión vigente, sin clave propia).
3. **/hoy, «Para hacer hoy: Elegir tus áreas»** figura sin hacer justo después de haber elegido carrera en el paso 1 (`ines-hoy-390`). Verificar si es lo esperado; archivo probable: `apps/web/app/(app)/hoy/page.tsx`.
4. La FAQ «¿Cuánto cuesta?» habla de un Plan Beta pago: pendiente de las respuestas legales de Mauro (C5), no es de este ticket.

### No concluyentes en local (lo verifica el CI del PR)
- **Contaduría, Administración, Marketing y Programación: falla «invitación, registro y onboarding» en `personas/flow.ts` (`getByTestId('skill-excel')` y equivalentes).** En la captura de Contaduría la pantalla «Tus skills» muestra 6 de las skills del puesto y no las que están en `role_skills.json` pero no estaban en la base (excel, power_bi, tableau, sql). **No concluyente en local (base sin seed, 75 skills); lo verifica el CI del PR.** Se probó una hipótesis (el servidor guarda el catálogo una hora, `apps/web/lib/skill-taxonomy.ts:24-44`) y se ajustó el spec para cargar las skills de las 8 personas antes de abrir pantallas; la cuarta corrida siguió fallando (contaduría y administración en `skill-excel`, marketing en `skill-seo`, programación en `skill-typescript`), así que la hipótesis no alcanzó. En el CI, con seed completo, los e2e 97 y 98 (contaduría y administración) pasan sobre main, por lo que se toma como un problema de datos de la base local. Abogacía, Comunicación y Rel. internacionales pasaron.
- **Relaciones públicas**: falló la prueba de /acceso (hallazgo conocido) y, al estar en serie, no corrió el resto; el spec ahora separa /acceso del recorrido. En la cuarta corrida la prueba de /acceso de RR.PP. siguió fallando (conocido) y el resto, sin verificar.

### Del entorno (no son de producto)
- `packages/adapters/src/privacy/privacy-scan.test.ts`: 3 tests fallan en Windows con `EPERM` al crear symlinks.
- «Ubicación permitida: aviso limitado a BR» en las ofertas del recorrido sale de cómo `seedPublicJobs` siembra el pool (`Remoto (Brasil)`), no de la app.

## Parte 2 (sobre C3+C8)

Rama local sobre `ronda/r5-c8-catalogos` (incluye C3), sin push. Resultados:

| Carrera | Spec 126 filtrado | Resultado |
| --- | --- | --- |
| Relaciones públicas | 6 de 6 | verde: /acceso (guarda `relaciones_publicas`), registro, onboarding, /hoy, /jobs, detalle, Perfil, CV y ayuda |
| Programación | 1 pasó, 1 falló, 4 sin correr | /acceso ok; falla `skill-typescript` en el onboarding, igual que sobre main: no concluyente en local (base sin seed), lo verifica el CI del PR |

Hallazgos nuevos o cambiados:
- **P1 · prefiltro de RR.PP. (arreglado en #457, ccc3318):** `ROLE_OWN_TITLE_PHRASES.relaciones_publicas` (`packages/pipeline/src/prefilter/prefilter.ts:163`) no liberaba «community manager» ni «social media manager»; esos avisos se descartaban para RR.PP. con `titulo_blocklist` y llegaban a Marketing (`prefilter.ts:153-161`). Ahora libera community manager, social media manager, brand manager, assistant brand manager, public affairs manager, event manager y events manager, con tests. Verificado con el caso `relaciones_publicas-04` en la rama local de la parte 2, donde estaba como fallo esperado antes del arreglo.
- **P2 · golden de marketing:** `marketing_digital-04` es un aviso de RR.PP.; C3 lo evalúa contra RR.PP. con un parche del test (`MOVED_TO_RRPP`). Hay que mover el caso al JSON de RR.PP.
- Resuelto: el chip de RR.PP. de /acceso ya guarda `relaciones_publicas` (era P2 conocido).
- Sin cambios: el P1 de criterios (`criteriaFromOnboarding` y `DISCIPLINES` no se tocaron en C3 ni en C8) y el P2 de la ayuda.

## Qué quedó sin cubrir
Lo marcado «sin verificar», la evaluación con modelo real y el onboarding de contaduría, administración, marketing y programación en una base con seed (lo hace el CI del PR).
