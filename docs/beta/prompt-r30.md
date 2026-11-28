Tanda R30 «Confianza». Armá un **EQUIPO DE AGENTES** con 3 teammates y vos como lead. Mecánica, reglas y cierre: `docs/beta/cadena-r30-r34.md`. Especificación: `docs/beta/plan-r30-r34.md` (secciones 2 a 7 y 9).

- Ramas `ronda/r30-NN-<nombre>`. e2e: 340 a 369. Bloque 48 del BACKLOG.
- **Base:** `origin/ronda/r30-base`. Es `main` con la R29 ya mergeada y sus migraciones aplicadas, más estos documentos.
- **Informe de Ani:** `ops/rondas/r30-tanda/informe-ani.pdf`. Cada ticket nombra sus IDs: leé esos puntos antes de tocar código.

## Reglas propias de esta tanda

- **Ningún modelo y ningún prompt.** Todo sale de datos que ya existen: la tabla de `packages/pipeline/src/evaluator/checklist.ts`, los campos del aviso y el perfil.
- **La tabla de requisitos es la única fuente** de todo lo que la pantalla dice sobre requisitos: conteos, «lo que más pesa», la línea de la tarjeta y la condición excluyente. Si un panel dice algo que la tabla no dice, el panel está mal.
- **Los bloques en español del detalle** («en pocas palabras», «qué vas a hacer», «qué buscan») son de la R31. Acá dejá el lugar listo y sin contenido inventado.
- **Las evaluaciones ya guardadas no se tocan.** Lo que cambia es cómo se muestran.

## Equipo y tickets

| Teammate | Tickets en orden |
|---|---|
| **base** | R30-01 → R30-02 → R30-12 → R30-13 |
| **listado** | R30-03 → R30-04 → R30-05 → R30-06 → R30-07 |
| **detalle** | R30-08 → R30-09 → R30-10 → R30-11 |

`listado` y `detalle` usan el glosario y los sellos: **R30-01 y R30-02 van primero.** Mientras tanto, `listado` hace la migración de R30-03 y `detalle` lee los puntos del informe y arma los tests de R30-09 en `packages/pipeline`. El lead hace R30-14 al final.

### R30-01 · Glosario, frases prohibidas y lista de verificación

IDs: R-01 a R-04, R-06, R-12, S-04, S-05, S-11, S-12, S-31, S-32.

- **Glosario:** el de la sección 3 del plan, en un solo módulo, y los textos en `apps/web/lib/textos-rediseno.ts`.
- **Test que falla** si en los textos de la interfaz o de los emails aparece:
  - una frase prohibida de la regla 2 del plan;
  - «Aplicada» como estado, «skills», «match» o «compatibilidad» como texto visible;
  - «te falta» o «no cumple» junto a un dato que el perfil no tiene.
- **«Muchos candidatos»:** las evaluaciones guardadas pueden traer ese riesgo. Se muestra solo si el aviso tiene `candidatesCount`, y entonces con el número.
- **`docs/beta/verificacion-informe-ani.md`:** creala con una fila por cada uno de los 159 IDs del informe (ID, de qué trata en una línea, tanda, estado, cómo verlo). Los que este plan deja para después llevan «después de abrir».

### R30-02 · Los cuatro sellos

IDs: R-05, R-08, R-09, S-01, S-16.

- `packages/pipeline/src/score-display.ts`: cuatro sellos con los cortes de la sección 4 del plan y el número con un decimal y coma («Afinidad alta · 7,4/10»). Tests primero, con los bordes: 4,9, 5, 6,9 y 7.
- Se cambia en todos lados: tarjeta, detalle, Hoy, Tracker, emails y el resumen diario. Que no quede ningún sello viejo.
- **«Cómo calculamos la afinidad»:** qué sale del aviso, qué del perfil y qué está sin confirmar. Revisá `transparency-block.tsx` antes de armar algo nuevo.
- La aclaración fija de la regla 5.

### R30-03 · «Guardada» (carril rojo)

IDs: R-11, R-16, R-17.

- Columna `saved_at` en `jobs`, con su migración. Es una marca con fecha, **no** un estado nuevo: `JOB_STATUSES` no cambia.
- Acciones «Guardar» y «Quitar de guardadas», con la sesión y el `user_id` de siempre. Test de integración: nadie guarda la oferta de otra persona.
- La pestaña «Guardadas» y la marca en la tarjeta y en el detalle.

### R30-04 · La tarjeta

IDs: R-13 a R-16.

- Lo de la sección 5 del plan: puesto, empresa, modalidad, sello con número, salario solo si está publicado y la línea «Sin confirmar: …» con hasta 2 cosas de la tabla.
- **Condición excluyente que no coincide:** arriba, con texto e ícono («No coincide: residencia en EE. UU.»), y la oferta baja en el orden. La regla que decide el orden va en `packages/pipeline`, con tests.
- Botones «Ver oferta», «Guardar» y «Descartar». Fuera las repeticiones.
- Una sola consulta para el listado: la tarjeta no suma consultas por oferta.

### R30-05 · Pestañas, chips y contador

IDs: R-10, R-17 a R-19.

- Pestañas y chips de la sección 5 del plan. Revisá `job-filters.tsx` y `apps/web/lib/jobs.ts` antes.
- **«Aceptan {tu país}»:** país, región o todo el mundo, explícitos en `countries_allowed`. Lo que es `null` no entra. La regla va en `packages/pipeline` (mirá `countries.ts`), con tests.
- **«Para empezar»:** usá la señal de nivel inicial que ya exista en los datos. Si no hay una confiable, el chip no se muestra y queda anotado.
- Cada chip con su número, el activo con ×, contador real, «Limpiar filtros», estado de carga y estado vacío con el texto de Ani.
- «+ Agregar una oferta» con su aclaración.
- Los filtros viven en la URL: se pueden compartir y volver atrás.

### R30-06 · Descartadas

IDs: R-20 a R-23.

- Tal cual el informe: fondo neutro, «Descartada por vos», «Volver a revisar», «Ver oferta» y el aviso «Oferta descartada. [Deshacer]».
- Aparecen en «Descartadas» y en «Todas». Nada tachado y nada que dependa solo del color.

### R30-07 · Vigencia

- Si la oferta viene del pool y la fuente ya no la muestra, la tarjeta y el detalle dicen «Este aviso ya no figura en {fuente}». Revisá cómo marca hoy el pool los avisos cerrados.
- De las ofertas que no vienen del pool no se afirma nada.
- Las que ya no figuran bajan en «Por revisar». No se borran ni se ocultan.
- Regla en `packages/pipeline`, con tests.

### R30-08 · El detalle: orden y «Lo importante para decidir»

IDs: R-24, R-26, R-30, S-16, S-17, S-19, S-20.

- El orden de la sección 6 del plan, con secciones plegables iguales en la computadora y en el celular.
- **«Lo importante para decidir»:** siempre las 7 filas, con lo que dice el aviso y «No especificado» cuando falta. Revisá `conditions-block.tsx` y `conditions-view.ts`. Nunca mezcla datos del perfil.
- **«Cómo encaja»:** el veredicto y hasta 3 cosas que más pesan, calculadas desde la tabla en `packages/pipeline`.
- **Antes de evaluar:** «Sin evaluar», «Evaluar esta oferta» y la estimación provisoria plegada.
- «Ver descripción original» a un toque. La descripción sigue en su `iframe` con `sandbox` vacío.

### R30-09 · La evaluación, sin contradicciones

IDs: S-02 a S-14, S-21 a S-32.

- **Una sola tabla de requisitos** a la vista, la de `checklist.ts`, con sus tres estados, el tipo (excluyente o deseable) y la fuente.
- **Todo lo demás se deriva de ella.** `fit-points-panel.tsx` y lo que arma `packages/pipeline/src/fit/fit-points.ts` dejan de mezclar bloqueadores, gaps, riesgos y datos faltantes: se reemplazan por un resumen calculado desde la tabla. Tests primero, con los casos de contradicción del informe.
- **Autorización de trabajo y residencia,** en dos filas distintas. El inglés, una sola vez. El área del puesto, como dato del aviso.
- **La condición excluyente se explica aparte de la afinidad,** como dice la sección 4 del plan.
- **Habilidades:** como dice la sección 6. Si hoy no se puede separar lo ligado al puesto de lo que habla de la empresa, mostrá solo las que salen de requisitos y dejalo anotado para la R31.
- **Lenguaje:** la tabla de Ani tal cual, con el glosario del plan. Un ⓘ en cada término técnico.

### R30-10 · «Preparar mi postulación»

IDs: R-31 a R-35, S-46 a S-49.

- Una sola sección y un solo botón de salida, como dice la sección 7 del plan. Revisá `apply-button.tsx`, `postular/`, `form-review.tsx` y `copy-all-button.tsx`.
- El botón «Ir a postularme en {sitio} ↗» va arriba y fijo en el celular, sin tapar contenido ni la barra de navegación.
- Se mantiene la pregunta al volver. Nada se marca solo.
- Los borradores marcan los huecos y no inventan datos. Como no hay modelo en esta tanda, eso se prueba con el modelo simulado.

### R30-11 · Valoración

IDs: S-43 a S-45.

- «¿Te sirve esta evaluación?» como dice la sección 6 del plan. Revisá `verdict.tsx` y `verdict-reason.tsx`: hoy los motivos aparecen con «Sí» y con «No».
- «Proponer otro puntaje», solo para testers y admins, con su aclaración. Sigue guardando `human_score` y `human_note`.

### R30-12 · Base de legibilidad

IDs: S-33 a S-42.

- **Tokens** de tamaño y de color de texto documentados (primario, secundario, deshabilitado) en `apps/web/app/globals.css` y en `docs/ux/`.
- **Regla que falla** (lint o test) si aparece un tamaño de texto debajo de 12 px, un color de texto fuera de la lista o una transparencia en texto. Arrancá con las pantallas de ofertas en modo estricto y el resto en una lista de excepciones que la R33 y la R34 van vaciando.
- **Aplicalo completo** en el listado, la tarjeta, el detalle y la evaluación: los sellos y los chips suben a 12 px o más.
- **Script de auditoría:** recorre esas pantallas en claro y oscuro, a 390 y 1280 px y con zoom al 200 %, y deja la lista de lo que no cumple con capturas en `ops/capturas/r30/legibilidad/`. Un resumen sin capturas va al informe, para la revisión de diseño.

### R30-13 · Parser de sueldo

ID: S-15.

- El parser no leyó un rango en dólares con punto de miles y guion largo (el caso del informe). Test con un caso inventado de ese formato y con sus variantes: punto de miles, guion largo, «k», rango con «a» y periodicidad.
- Falla cerrado: si no entiende, el salario queda sin informar. Nunca un número a medias.

### R30-14 · Calidad (lead)

- **e2e:** listado con filtros y contador; guardar y quitar; descartar y deshacer; detalle sin evaluar; detalle evaluado con una condición excluyente que no coincide; «Preparar mi postulación» hasta el botón de salida.
- 390 y 360 px, teclado y axe sin violaciones serias.
- Capturas antes y después en `ops/capturas/r30/`.
- `verificacion-informe-ani.md` al día.

## Cierre

El de `docs/beta/cadena-r30-r34.md` §3. En los pasos manuales: la migración de `saved_at`, cómo probar cada pantalla con Ani y la lista de textos nuevos para aprobar. Después, **seguí con la R31.**
