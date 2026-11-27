# Informe de la tanda R31 «Ficha del aviso»

Cierre de la R31 (26/11). Especificación: `docs/beta/plan-r30-r34.md` §6 y §8; tickets: `docs/beta/prompt-r31.md`. Decisión de diseño: `docs/adr/048-ficha-del-aviso-compartida.md`. **Costo en modelos de la tanda: USD 0** (todo con el modelo simulado; ninguna eval paga, ningún comando de reevaluación ejecutado). Los pasos para el responsable del proyecto están en `docs/beta/pasos-manuales-r31.md`; el estado de cada punto del informe de revisión, en `docs/beta/verificacion-informe-ani.md`.

**Todo está detrás de `JOB_CARD`** (apagada por defecto, `testers` o `all`), con el mismo patrón que `CV_COACH`. Con la variable apagada la app se ve y se comporta igual que al cerrar la R30. Nada se promueve: el prompt de la ficha y `evaluate_job@v1.5.0` son archivos nuevos y el ruteo de producción no cambia.

## Qué entró por ticket

**R31-01 · Datos de la ficha.** Tabla `job_cards` (migración 0087 y RLS 0071): una fila por `jd_hash`, única, sin `user_id` y sin nada que diga quién la pidió, con estado `lista`, `fallida` o `sin_texto`, versión de prompt y de esquema, modelo y copias de área, idioma, nivel de inglés y modalidad para que `/market` cuente sin abrir el JSON. La app solo la lee, y solo si el hash coincide con una oferta suya o con un aviso del pool; la escribe el proceso de servicio. Normalización y `jobCardHash` puros, con tests. ADR-048: por qué una ficha compartida, por qué el hash y qué pasa si el aviso cambia de texto.

**R31-02 · El prompt y el validador.** `extract_job_card@v1` y su fila de `model_routing` (modelo barato). `verifyJobCard` busca cada cita en el texto y descarta lo que no encuentra; además comprueba que la cita diga lo que el dato afirma («remoto» citado para «desde cualquier país» se descarta), que indispensable y deseable solo salgan si el aviso los marca, y que un aviso que dice «remoto mundial» y exige estar en un país quede `contradictorio`. Una cita o un texto con instrucciones para el modelo se descarta. Esquema Zod estricto, sin campo de estado frente al perfil: el modelo nunca dice «coincide». El modelo simulado de los e2e arma fichas con citas literales (`DEMO_FICHA_FALLA` y `DEMO_FICHA_INYECTA` para los casos de error y de inyección).

**R31-03 · Cuándo corre.** Siempre antes de evaluar (el worker, el cron y la evaluación inmediata); a pedido, la primera vez que alguien abre el detalle («Preparando el resumen…»); y en el ingreso a través de la cola `evaluate_job` que ya existía. Una sola vez por hash: la reserva bajo el lock global de gasto, más la restricción única (test de concurrencia: 8 pedidos a la vez, 1 llamada, 1 fila). Sin texto suficiente no se llama al modelo. Tope diario de fichas y de gasto (por defecto 100 fichas y USD 1 por 24 horas, con `JOB_CARD_DAILY_MAX` y `JOB_CARD_DAILY_USD`); al tope, el estado `tope` y el resto de la app sigue. Cada intento queda en `llm_calls` con `user_id` nulo. No hay una pasada sobre todo el pool.

**R31-04 · El detalle en español.** «La oferta en pocas palabras», «Qué vas a hacer» y «Qué buscan» (indispensable y deseable solo si todos los requisitos traen nivel; si no, una lista sola), cada dato con «Así lo dice el aviso» como texto, nunca como HTML. «Lo importante para decidir» usa lo que la ficha citó. Estados: «Preparando el resumen…» con esqueleto de altura fija, error con «Reintentar», «Pegá la descripción para ver el resumen» y tope. «Ver descripción original» sigue a un toque.

**R31-05 · La tabla con las filas del aviso.** `buildCardRows` suma las filas `req:<n>` desde la ficha, cada una con su cita; el código decide el estado comparando solo lo que se puede comparar (inglés con su nivel, años, lugar, residencia, autorización de EE. UU. y la UE, habilidades con nivel cargado). Lo demás queda «Sin confirmar» con la pregunta de un toque (Sí, No, En parte): «Sí» pasa a Coincide, «No» a No coincide, «En parte» sigue sin confirmar con la nota. La respuesta vale para las demás ofertas que pidan lo mismo (`requirementKey`). Tabla nueva `requirement_answers` (migración 0088, RLS 0072; `candidate_facts` no sirvió porque lo lee el servidor MCP como hechos afirmables). Sin filas repetidas: el inglés, una sola vez; autorización y residencia, en filas distintas. El área del puesto deja de ser un requisito cuando coincide.

**R31-06 · `evaluate_job` versión nueva.** `evaluate_job.v1.5.0.md`, archivo nuevo (la v1.4.0 no se tocó). Sirve para cualquier carrera y para avisos locales o presenciales, recibe la ficha (`{{ficha}}`, como dato delimitado, con «FICHA NO DISPONIBLE» como respaldo), saca «muchos candidatos» de los riesgos salvo que el aviso traiga el número, trata el área como dato y deja la condición que depende solo del aviso aparte, sin bajar el puntaje. La salida es la misma de la v1.4.0: el parser acepta las dos versiones. El golden propuesto (24 casos, 8 carreras) está en `ops/rondas/r31-tanda/R31-06/propuesta/`.

**R31-07 · Lo que se alimenta de la ficha.** La línea «Sin confirmar: …» de la tarjeta y «lo que más pesa» salen de la tabla nueva, con las respuestas de un toque y el perfil de hoy superpuestos (`cardItemsNow`), sin consultas por oferta. «Habilidades» muestra solo las que la ficha liga al puesto (resuelve lo que la R30 dejó anotado). La ficha guarda área, idioma, nivel y condiciones para que `/market` los cuente después; `/market` no se cambió.

**R31-08 · «Esto mismo te pasa en N de tus M ofertas».** Conteo puro en `packages/pipeline` sobre las tablas de las ofertas abiertas (`evaluada`); solo se ofrece con N de 2 o más. Junto a «lo que más pesa», un botón («Actualizar mi inglés», «mis años de experiencia», «mi país») abre solo ese campo, no la página de perfil. Al guardar, las ofertas afectadas se recalculan al mostrar, sin llamar al modelo.

**R31-09 · Reevaluación única.** Un comando con dry-run por defecto, tope de gasto obligatorio (hasta USD 50), corte y retomada, evaluación anterior guardada y vuelta atrás (`--rollback`). Probado con el modelo simulado en Testcontainers. **No se ejecutó contra ninguna base que no sea la de los tests.**

**R31-10 · Kit para calibrar.** `/calibracion` para testers y admins con `JOB_CARD` encendida: entre 20 y 30 ofertas propias variadas, evaluadas con la versión nueva, con «¿Te sirve esta evaluación?» y «Proponer otro puntaje». Exportación en CSV para el admin (`/admin/calibracion/export`, función de la base `admin_calibration_marks`, RLS 0073), sin datos personales y con emails, teléfonos y enlaces del motivo enmascarados. Guía en `docs/beta/calibracion-r31.md`.

## Decisiones

- **Una ficha por texto, compartida.** Sin `user_id`; escribe solo el proceso de servicio, así nadie puede plantar una ficha falsa que vean las demás personas.
- **El modelo propone y el código decide.** Cada dato lleva su cita verificada; lo que no verifica se descarta. El estado frente al perfil no existe en la ficha.
- **`sin_distinguir` cuenta como deseable** en la tabla (no se inventan excluyentes). Los bloqueadores los sigue decidiendo `decide()`.
- **Años en un rubro** («3 años en ventas») no se confirman con el total del perfil: quedan «Sin confirmar».
- **Respuestas de un toque en tabla propia**, no en `candidate_facts`.
- **«La condición que depende solo del aviso va aparte»** se resolvió como regla del prompt, sin campo nuevo en la salida; si hace falta un campo propio es un cambio de esquema y de `decide()`.
- **Reevaluación:** «abiertas» = `evaluada`; no pasa por las reservas de gasto diarias, el control es `--max-usd`.
- **Seguridad:** el rol de seguridad encontró **1 medio y 5 bajos, arreglados o documentados** (detalle fuera del repo).

## Lo no cumplido o con reservas

- **Ninguna eval corrida.** La calidad real del prompt de la ficha y de `evaluate_job@v1.5.0` no está medida (USD 0 en la tanda). Los anclas del golden propuesto son sintéticos y los tiene que revisar el responsable.
- **El harness de evals no pasa la ficha** (`evals/src/golden.ts` está denegado): medir v1.5.0 con ficha pide un parche chico y una ficha por caso.
- **Textos sin cotejar con el informe de revisión** (no se pudo leer el PDF): quedan marcados `PENDIENTE-INFORME` en `apps/web/lib/textos-rediseno.ts`.
- **Ficha en el ingreso:** no hay una generación inmediata al ingresar un aviso; corre cuando alguien evalúa o abre la oferta. Si se quiere sin esperar, es un `after()` en el ingreso (otro ticket).
- **Lectura de la ficha con RLS:** una oferta con `jd_hash` nulo pero con texto no ve su ficha (queda en «Preparando»).
- **Tope de fichas global**, no por persona: una cuenta puede agotarlo. Hay que sumar un ritmo por persona antes de `JOB_CARD=all`.
- **Fichas huérfanas:** `purgeOrphanJobCards` existe y está probada, pero no está programada.
- **Sin link de entrada a `/calibracion`:** se comparte la URL.
- **Motivo de calibración:** la base lo devuelve sin máscara; el enmascarado es de la app. Un nombre propio no se puede detectar.
- **Marca de calibración:** queda sobre la evaluación guardada; si se reevalúa, la marca queda en la anterior.

## Costo estimado

**Todo lo de abajo es estimación con supuestos; nada se midió** (la tanda no llamó a ningún modelo). Las tarifas salen de `packages/db/seeds/model_routing.json` (USD por millón de tokens, entrada y salida).

| Tarea | Modelo (respaldo) | Entrada | Salida |
|---|---|---|---|
| `extract_job_card` | `claude-haiku-4-5` (`gemini-3.5-flash`) | 1 (respaldo 1,5) | 5 (respaldo 9) |
| `evaluate_job` | `claude-sonnet-5-5` (`gemini-3.5-flash`) | 2 (respaldo 1,5) | 10 (respaldo 9) |

Fórmula: `costo = tokens_entrada × tarifa_entrada / 1.000.000 + tokens_salida × tarifa_salida / 1.000.000`.

**Por ficha** (una vez por texto, no por persona):
- Supuesto: unos 3.000 tokens de entrada (aviso de hasta 12.000 caracteres más el prompt) y unos 1.200 de salida. Con el modelo primario: 3.000 × 1 / 1.000.000 + 1.200 × 5 / 1.000.000 = 0,003 + 0,006 = **USD 0,009**.
- Techo por ficha (salida agotando `max_tokens` = 3.500): 0,003 + 0,0175 = USD 0,0205. La reserva por ficha del código es USD 0,07 (primario y respaldo agotando el tope), que es lo que descuenta de los topes diarios.
- Tope diario por defecto: 100 fichas o USD 1, lo que ocurra primero (a USD 0,009 por ficha, 100 fichas son unos USD 0,90).

**Por evaluación nueva** (`evaluate_job@v1.5.0`):
- Dos supuestos de tamaño. El del comando de reevaluación: 3.000 tokens de entrada y 600 de salida → 3.000 × 2 / 1.000.000 + 600 × 10 / 1.000.000 = 0,006 + 0,006 = **USD 0,012**. Un supuesto más prudente, con el prompt nuevo y la ficha en la entrada: 6.300 de entrada y 500 de salida → 0,0126 + 0,005 = **USD 0,0176**. La medición más reciente de v1.3.2 (4.102 de entrada y 418 de salida, con el modelo de respaldo a 1,5 y 9) fue de USD 0,0099 por evaluación. Tomá **USD 0,012 a 0,018** como rango hasta medir.
- Si cae al modelo de respaldo, es algo menor: 6.300 × 1,5 / 1.000.000 + 500 × 9 / 1.000.000 = USD 0,014.

**Ejemplos** (cuentas, no mediciones):
- Calibración de 24 ofertas: 24 × 0,0176 = unos **USD 0,42** (más las fichas que falten).
- Reevaluación única de 300 ofertas abiertas con ficha nueva en todas: 300 × (0,0176 + 0,009) = unos **USD 8**. Con el tope `--max-usd` se corta antes si hace falta. Si las fichas ya existen, 300 × 0,0176 = unos USD 5,3.

**Qué es supuesto:** todos los tamaños de entrada y de salida (no se llamó a ningún modelo), que no haya reintentos, que el respaldo no se use y que los avisos no pasen del tope de 12.000 caracteres. La primera corrida real de evals y de calibración da los números medidos; hay que reemplazar acá estas cifras cuando existan.

## Verificación

- `pnpm typecheck`: 6 de 6 paquetes, 0 errores.
- Lint: 0 errores; Prettier limpio.
- Unit: pipeline 7073, web 651, db 198, prompts 38, adapters 1755 (más las 3 fallas conocidas de abajo).
- Integración (Testcontainers), corridas por los teammates en cada ticket: `job-cards` 11 de 11, `requirement-answers` 10 de 10, `calibration-marks` 8 de 8, `multiusuario` 324 de 324, `delete-account` 5 de 5, la ficha en adapters 28, `evaluate-hook` 2, reevaluación 10 de 10.
- Fallas conocidas y ajenas a la tanda: 3 de `privacy/privacy-scan.test.ts` por enlaces simbólicos de Windows; 4 de `evals` (`run.test.ts` y `golden.test.ts`) por el conteo del golden que carga la máquina (37 esperados, 36 en la de desarrollo).
- Privacidad: `node .claude/bin/privacy-scan.mjs` sin hallazgos en los commits de la tanda (ver el cierre).
- e2e, en local con `JOB_CARD=testers` en el `webServer` de `playwright.config.ts`: 370 a 375, 377, 378, 382, 383 y 384 verdes; 376 se saltea en local (necesita `ADMIN_EMAILS` en el runner; corre en el CI). Las personas fuera de la etapa usan la persona sin rol de `voz-helpers.ts`.
- **Sin regresión de la R30:** 348 a 352, 358 a 361, 07 y 63 verdes con la ficha encendida en el servidor. Además, 348 a 361 corrieron con la persona A como admin (como en el CI, donde ve la ficha) y siguieron verdes.
- 383 cubre teclado y axe a 390 y 360 px. No se sacaron capturas nuevas en esta tanda.
- El caso «`JOB_CARD` realmente apagada en el servidor» lo cubren los tests unitarios del flag y la persona fuera de la etapa en los e2e: el servidor de los e2e corre siempre con `testers`.
