Tanda R31 «Ficha del aviso». Armá un **EQUIPO DE AGENTES** con 3 teammates y vos como lead. Mecánica, reglas y cierre: `docs/beta/cadena-r30-r34.md`. Especificación: `docs/beta/plan-r30-r34.md` (secciones 6 y 8).

- Ramas `ronda/r31-NN-<nombre>`. e2e: 370 a 389. Bloque 49 del BACKLOG.
- **Base:** `origin/ronda/r30-integracion` si existe; si no, `origin/ronda/r30-cierre`.

## Reglas propias de esta tanda

- **USD 0.** Todo se prueba con el modelo simulado. Las evals las corre Mauro: dejale los comandos.
- **Nada se promueve.** El prompt de la ficha es nuevo y la versión nueva de `evaluate_job` va en un archivo nuevo. El ruteo de producción no cambia.
- **Todo detrás de `JOB_CARD`** (apagada, `testers` o encendida), con el mismo patrón que `CV_COACH`. Con la variable apagada, la app se ve igual que al cerrar la R30.
- **El modelo propone y el código decide.** El modelo dice qué pide el aviso y dónde lo dice. El estado de cada requisito lo decide el código. El modelo nunca dice «coincide».
- **El texto del aviso viene de afuera.** Va al prompt como dato, con el mismo cuidado que ya tienen los prompts que leen avisos. Lo que devuelve el modelo se valida con Zod y nunca se muestra como HTML.

## Equipo y tickets

| Teammate | Tickets en orden |
|---|---|
| **ficha** | R31-01 → R31-02 → R31-03 → R31-09 |
| **evaluacion** | R31-05 → R31-06 → R31-10 |
| **pantalla** | R31-04 → R31-07 → R31-08 |

**R31-01 y el esquema de R31-02 van primero:** `evaluacion` y `pantalla` trabajan contra el tipo de la ficha. Mientras tanto, `evaluacion` escribe los tests de la comparación y `pantalla` arma los bloques con una ficha de ejemplo. El lead hace R31-11 al final.

### R31-01 · Datos de la ficha (carril rojo)

- **Tabla nueva `job_cards`,** una fila por descripción:
  - clave: hash del texto normalizado del aviso (la normalización va en `packages/pipeline`, con tests);
  - el contenido de la ficha, la versión del prompt, el modelo, la fecha y el estado (lista, fallida o sin texto suficiente).
- **No lleva `user_id`:** sale solo del texto de un aviso y es la misma para todas las personas. Por eso mismo **no guarda nada que diga quién la pidió.**
- **RLS con `FORCE`:** una persona lee una ficha solo si el hash coincide con una oferta suya o con un aviso del pool. Escribe solo el proceso que la genera. Test de integración de los dos casos y del caso negado.
- **ADR nuevo** con la decisión: por qué una ficha compartida, por qué el hash y qué pasa si el aviso cambia de texto.

### R31-02 · El prompt y el validador

- **Prompt nuevo `extract_job_card.v1.md`** y la tarea `extract_job_card` en el seed de `model_routing`, con un modelo barato. El seed es carril rojo.
- **Qué devuelve,** con su esquema en Zod:
  - resumen de 2 o 3 frases, en español;
  - tareas;
  - requisitos, cada uno con nivel (indispensable, deseable o sin distinguir);
  - las 7 condiciones: modalidad, desde dónde se puede trabajar, salario, experiencia, inglés, jornada y tipo de contratación;
  - habilidades ligadas al puesto, área e idioma del aviso.
- **Cada dato lleva su cita literal.** El validador de `packages/pipeline` busca la cita en el texto y **descarta lo que no encuentra.** Tests primero, con estos casos:
  - una cita inventada;
  - una cita que existe pero no dice lo que el dato afirma (por ejemplo, «remoto» citado para «desde cualquier país»);
  - un aviso que no distingue indispensable de deseable;
  - un aviso en inglés, uno en español y uno en portugués;
  - un aviso que dice «remoto mundial» y más abajo exige estar en un país;
  - un aviso con instrucciones para el modelo metidas en el texto.
- **Nada se deduce.** Lo que el aviso no dice queda vacío y la pantalla muestra «No especificado».
- Respuestas del modelo simulado para los e2e, con avisos inventados.

### R31-03 · Cuándo corre

- **En el ingreso,** solo para los avisos que pasan el prefiltro de alguna persona. Usá la cola que ya existe.
- **A pedido,** la primera vez que alguien abre el detalle y no hay ficha.
- **Siempre antes de evaluar.**
- **Una sola vez por hash:** dos personas que abren el mismo aviso a la vez no generan dos fichas. Test de concurrencia.
- **Tope diario** de fichas y de gasto, con los módulos de presupuesto que ya existen, y registro en `llm_calls`. Al llegar al tope, la pantalla lo dice y el resto de la app sigue.
- **Sin texto suficiente:** no se llama al modelo.
- No hay pasada sobre todo el pool.

### R31-04 · El detalle en español

IDs: R-25, R-26, R-28, R-29.

- Los bloques «La oferta en pocas palabras», «Qué vas a hacer» y «Qué buscan», en el lugar que dejó la R30.
- «Lo importante para decidir» usa la ficha cuando existe. Cada fila puede mostrar su cita («Así lo dice el aviso»).
- **Estados:** «Preparando el resumen…», con un esqueleto que no mueve la página; error con reintento; y sin descripción, «Pegá la descripción para ver el resumen», con el botón que ya existe para pegarla.
- «Ver descripción original» sigue a un toque.

### R31-05 · La tabla con las filas del aviso

IDs: S-02, S-05 a S-07, S-21 a S-25.

- `checklist.ts` suma las filas `req:<n>` con los requisitos de la ficha, cada una con su cita. Es la fase B que el archivo ya tiene prevista.
- **El estado lo decide el código,** comparando con el perfil lo que se puede comparar: idioma con su nivel, años, lugar, autorización y habilidades con nivel cargado. Tests primero.
- **Lo que no se puede comparar queda «Sin confirmar»** y ofrece una **pregunta de un toque:** «Sí», «No» o «En parte».
  - La respuesta se guarda en el perfil y vale para las demás ofertas que pidan lo mismo.
  - «Sí» pasa a «Coincide», «No» a «No coincide» y «En parte» sigue «Sin confirmar», con la nota de la persona.
  - Revisá `candidate_facts` antes de crear una tabla. Si hace falta una nueva: `user_id`, RLS y cascada.
- Sin filas repetidas entre lo fijo y lo que viene del aviso: el inglés, una sola vez.

### R31-06 · `evaluate_job`, versión nueva

IDs: S-08, S-12, S-22.

- **Archivo nuevo** `evaluate_job.v1.5.0.md`. La v1.4.0 no se toca.
- **Qué cambia:**
  - sirve para cualquier carrera y para avisos locales o presenciales: fuera la persona de «reclutador de tecnología para trabajo remoto»;
  - recibe la ficha, así no vuelve a extraer lo que ya está extraído;
  - «muchos candidatos» sale de la lista de riesgos, salvo que el aviso traiga el número;
  - el área del puesto es un dato, no un requisito;
  - la condición que depende solo del aviso va aparte.
- El puntaje sigue sin bajar por condiciones.
- **El parser acepta las dos versiones:** las evaluaciones viejas se siguen leyendo.
- **Golden:** la propuesta completa va a `ops/rondas/r31-tanda/R31-06/propuesta/`, con casos nuevos de las 8 carreras de la beta, avisos locales en español incluidos.

### R31-07 · Lo que se alimenta de la ficha

- La línea «Sin confirmar: …» de la tarjeta y «lo que más pesa» salen de la tabla nueva cuando la oferta tiene ficha.
- **Habilidades:** solo las ligadas al puesto según la ficha. Queda resuelto lo que la R30 dejó anotado.
- **Mercado:** la ficha guarda área, idioma, nivel y condiciones de forma que `/market` los pueda contar después. Acá no se cambia `/market`.

### R31-08 · «Esto mismo te pasa en N de tus M ofertas»

ID: S-18 (y R-02).

- El conteo se hace en `packages/pipeline` sobre las tablas de requisitos de las ofertas abiertas de la persona. Tests primero.
- Aparece junto a «lo que más pesa», con un botón que abre **solo ese campo** («Actualizar mi inglés») en el lugar o en un modal, no la página de perfil entera.
- Al guardar, las ofertas afectadas se actualizan sin volver a llamar al modelo: el estado lo decide el código.

### R31-09 · Reevaluación única

- **Un comando** para reevaluar una vez las ofertas abiertas con la versión nueva:
  - `--dry-run` por defecto: cuenta cuántas son y estima el gasto, sin llamar a nadie;
  - con tope de gasto obligatorio; se puede cortar y retomar;
  - guarda la evaluación anterior, para poder comparar y volver atrás.
- **No se corre en esta tanda.** Va a los pasos manuales: lo corre Mauro, con la variable prendida y el prompt promovido.

### R31-10 · Kit para calibrar

- Una vista para testers y admins donde se marca, oferta por oferta, si la evaluación nueva está bien, con un motivo corto. Reutilizá «¿Te sirve esta evaluación?» y «Proponer otro puntaje».
- Una exportación para el admin, sin datos personales, con lo marcado.
- `docs/beta/calibracion-r31.md`: cómo elegir entre 20 y 30 ofertas variadas (carreras, idiomas, con y sin condición excluyente) y qué mirar en cada una.

### R31-11 · Calidad (lead)

- **e2e con el modelo simulado:** abrir un detalle sin ficha y verla aparecer; aviso sin descripción; pregunta de un toque que cambia el estado en dos ofertas; tope alcanzado; `JOB_CARD` apagada (todo como en la R30).
- 390 y 360 px, teclado y axe.
- Costo estimado por ficha y por evaluación nueva, en el informe.
- `verificacion-informe-ani.md` al día.

## Cierre

El de `docs/beta/cadena-r30-r34.md` §3. En los pasos manuales, en este orden: la migración y la RLS; la fila de `model_routing`; los comandos de las evals; `JOB_CARD=testers`; la calibración con Ani; promover `evaluate_job`; la reevaluación con su tope. Después, **seguí con la R32.**
