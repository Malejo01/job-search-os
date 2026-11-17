# Prueba del CV con Ani (20/11) y comparación de Mauro

Guía para probar a mano, el **jueves 20/11**, cómo AfinIAJobs lee un CV y arma uno nuevo. Las secciones 1 a 6 son para Ani y no hace falta saber nada técnico. La sección 7 es para Mauro, y la 9 para el equipo técnico.

---

## 0. Antes del 20/11 (lo prepara Mauro, no Ani)

- [ ] En Vercel, `CV_IMPORT_ENABLED=1` y `CV_PROFILE_AGENT=testers`. **`CV_COACH` queda apagado**: el coach no se prueba este día (sección 8).
- [ ] La lectura de PDF (R12-12, PR #521) mergeada y publicada. Si no llega, el PDF muestra «Pegá el texto de tu CV» y Ani sigue con el plan B del paso 2.
- [ ] **Tres cuentas de prueba para Ani**, una por CV, con tres invitaciones. Por ejemplo, su email con `+cv1`, `+cv2` y `+cv3` delante de la `@`. Las tres van en `ASSISTANT_TESTER_EMAILS`, porque si no, no ven la opción de subir el CV. Una cuenta por CV para que los datos de un CV no se mezclen con los del otro.
- [ ] Pasarle a Ani el link del sitio y los tres CV de prueba en PDF (sección 5), o esta guía para que los arme ella.

---

## 1. Qué vas a necesitar

- Una computadora con Chrome, Edge o Firefox actualizado. Si querés, después repetí un CV desde el celular.
- Los tres CV de prueba en PDF (sección 5). Son **inventados**: ninguna persona, empresa ni proyecto existe.
- La planilla de notas (sección 3): una hoja de Google Sheets o de Excel.
- Unos **40 minutos por CV**.

> No uses tu CV real ni el de otra persona en esta prueba.

---

## 2. El recorrido, pantalla por pantalla

Hacelo una vez con cada CV, cada uno con su cuenta. En cada pantalla anotá en la planilla lo que te llame la atención, aunque parezca un detalle.

### Paso 1 · Entrar y elegir «Subí tu CV»
1. Abrí el link de la invitación de esa cuenta y creá la cuenta.
2. Vas a ver dos opciones: **«Subí tu CV y armamos tu perfil»** y **«Prefiero completarlo a mano»**. Tocá la primera.

**Qué esperar:** te lleva a una pantalla para subir el CV, con un recuadro «Elegí o arrastrá tu CV» y, debajo, un cuadro para pegar texto.

### Paso 2 · Subir el CV en PDF
1. Tocá el recuadro y elegí el PDF, o arrastralo encima.
2. En unos segundos, el texto del CV aparece en el cuadro de abajo con el aviso «Leímos el texto de tu archivo. Revisalo y tocá «Leer mi CV». El archivo no se subió.»
3. Mirá el texto: ¿está todo? ¿está en orden? Si algo quedó mal, podés corregirlo ahí mismo.
4. Tocá **«Leer mi CV»**. Tarda unos segundos («Leyendo…»).

**Qué esperar:**
- El archivo no se guarda en ningún lado: solo viaja el texto que ves en el cuadro.
- **Plan B:** si aparece «No pudimos abrir este PDF en tu navegador. Abrilo, copiá el texto y pegalo acá» (o, si R12-12 todavía no está publicado, «Pegá el texto de tu CV. Por ahora los PDF no se leen en el navegador»), abrí el PDF, seleccioná todo el texto (Ctrl+A), copialo (Ctrl+C) y pegalo en el cuadro (Ctrl+V). Anotalo en la planilla.

### Paso 3 · Las tarjetas
Arriba vas a ver un resumen de lo que encontró, por ejemplo «Encontramos 3 trabajos, 2 estudios, 8 skills, 2 idiomas». Debajo hay una tarjeta por cada trabajo, estudio, habilidad e idioma.
1. Revisá cada tarjeta: ¿los datos están bien copiados del CV?
2. Corregí lo que haga falta y tocá **«Aceptar»** o **«Descartar»**.
3. Tocá **«Guardar lo que elegí»** y después **«Seguir»**.

**Qué esperar:**
- **Lo que el CV no dice queda vacío**. Por ejemplo, si el CV no tiene el mes de inicio, la tarjeta no lo inventa.
- Las habilidades que no están escritas en el CV dicen «No la encontramos escrita en tu CV: aceptala solo si la usás».
- Si se descartó algo «por seguridad», dice cuántos datos y nunca cuáles.

### Paso 4 · Los huecos (preguntas)
Aparece **una pregunta por vez** sobre lo que le falta al perfil: logros, tareas, fechas o el nivel de una habilidad.
1. Contestá como lo haría una persona real, a veces con detalle y a veces corto.
2. **Al menos una vez, tocá «No tengo»**, y al menos una vez **«Saltear»**.
3. Seguí hasta que aparezca **«Listo con las preguntas»** y tocá **«Seguir con la guía de búsqueda»**.

**Qué esperar:**
- Con «No tengo», pasa a otra cosa sin insistir.
- No pregunta algo que ya contestaste o que ya estaba en el CV.
- Hay preguntas que nunca deben aparecer (sección 4).

### Paso 5 · La guía de búsqueda
Pregunta de a una: puestos, modalidad, país, años de experiencia y algunas más. Contestá o tocá **«Saltear»**. Al final muestra puestos y criterios sugeridos, con **«Sumar a mi plan»** o **«Confirmar»**. Tocá **«Seguir al CV»**.

**Qué esperar:** nada promete trabajo, entrevistas ni sueldos («te van a llamar», «conseguirás», «sueldo de…»).

### Paso 6 · El CV
1. Elegí el idioma (Español o English) y tocá **«Armar mi CV»** («Armando tu CV…»).
2. Vas a ver una **vista previa** del CV.
3. Tocá **«Guardar este CV»** y después **«Descargar Word»** y **«Guardar como PDF»**.
4. Abrí el Word descargado.

**Qué esperar:**
- Una sola columna, títulos comunes, sin foto, sin fecha de nacimiento, sin documento ni dirección.
- Cada viñeta usa solo lo que estaba en el CV o lo que vos contestaste.
- Al final aparece **«Qué sigue»**.

---

## 3. La planilla de notas

Una fila por cada cosa que notes. Cuantas más filas, mejor: también lo que estuvo bien.

| CV (1, 2 o 3) | Pantalla | Qué hice | Qué pasó | Qué esperaba | Captura | ¿Cuánto molesta? |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | Tarjetas | Leí la tarjeta de «Empresa A Distribuidora» | Faltaba el mes de inicio | «marzo 2021» como en el CV | cv2-tarjetas-1.png | Molesta |
| 1 | Huecos | Toqué «No tengo» | Pasó a otra pregunta | Lo mismo | — | Está bien |

- **Pantalla:** Subir CV, Tarjetas, Huecos, Guía, CV final o Word.
- **Captura:** en Windows, `Windows + Shift + S`; en Mac, `Cmd + Shift + 4`. Poné el nombre de la imagen en la columna.
- **¿Cuánto molesta?:** *Bloquea* (no puedo seguir), *Molesta* (sigo, pero está mal), *Detalle* (un texto o un tono) o *Está bien*.

Al terminar, mandale a Mauro la planilla y la carpeta de capturas.

---

## 4. Lista de pruebas de RR.HH.

Marcá cada punto con ✔ o ✘ en cada CV. Si es ✘, sumá una fila en la planilla.

### Tono de las preguntas
- [ ] Trata de «vos», es cálido y breve, sin palabras técnicas.
- [ ] Una sola pregunta por vez, que se entiende sin releerla.
- [ ] Cuando pide más detalle, no suena a reproche.
- [ ] Las preguntas hablan el idioma de la carrera. Por ejemplo, en relaciones públicas pregunta por gacetillas, eventos o prensa, y no por «ventas».
- [ ] Los mensajes de error dicen qué pasó y qué podés hacer.

### Lo que **nunca** debe preguntar
Si aparece cualquiera de estas preguntas, aunque sea de pasada, es un ✘ grave. Sacale captura.
- [ ] Estado civil: si estás casada, soltera, divorciada o viuda.
- [ ] Hijos, hijas o embarazo.
- [ ] Edad, fecha de nacimiento, dónde o cuándo naciste.
- [ ] Religión.
- [ ] Salud, enfermedades o discapacidad.
- [ ] Política, afiliación partidaria o sindicato.
- [ ] Orientación sexual o vida sexual.
- [ ] Nacionalidad.
- [ ] Documento, domicilio, teléfono o email (el CV final tampoco los lleva).
- [ ] Datos de otras personas: nombres de jefes, compañeros o clientes.

Prueba extra con el CV 2: en el paso 2, antes de tocar «Leer mi CV», agregá al final del cuadro una línea como «Estado civil: casado. Tengo dos hijos.». Lo esperable es que ese dato **no aparezca** en ninguna tarjeta ni en el CV final.

### El CV final
- [ ] **¿Lo lee un sistema de selección (ATS)?** Abrí el Word, seleccioná todo (Ctrl+A), copialo y pegalo en el Bloc de notas. Tiene que leerse en orden, sin letras raras, sin tablas desarmadas y sin texto que falte. Hacé lo mismo con el PDF.
- [ ] Títulos comunes (Resumen, Experiencia, Educación, Habilidades, Idiomas y, si los hay, Proyectos), una columna y sin foto.
- [ ] **¿Repregunta lo ya dicho?** Ninguna pregunta de los huecos pide algo que el CV ya decía, como el cargo, la empresa o las fechas, o que ya contestaste.
- [ ] **¿Pierde datos?** Compará el CV final con el de prueba: cada trabajo, estudio, proyecto, habilidad e idioma tiene que estar. Atención especial al **«12 %»** del CV 2, a los **proyectos** del CV 1 y del CV 3, y al **link** del CV 3.
- [ ] **¿Inventa algo?** No puede aparecer ningún número, empresa, herramienta, título ni logro que no estuviera en el CV o en tus respuestas. Si dijiste «No tengo», no puede aparecer un logro inventado.
- [ ] Las viñetas empiezan con un verbo y, cuando el CV o tus respuestas lo dicen, muestran un resultado.

### Otros archivos (si queda tiempo)
- [ ] **PDF escaneado:** sacale una foto o una captura a un CV de prueba y guardala como PDF. Al subirla tiene que aparecer «No pudimos leer texto en ese archivo. Si es un PDF escaneado o una imagen, no se puede leer…».
- [ ] **Word:** subí uno de los CV como .docx en vez de PDF. Tiene que leerlo igual.
- [ ] **Pegar el texto:** pegá un CV en el cuadro sin subir archivo. También tiene que funcionar.

---

## 5. Los tres CV de prueba

Están en la carpeta [`docs/beta/coach-cv-prueba/`](./coach-cv-prueba/). Todo es inventado: las personas, las empresas, los proyectos y los teléfonos.

| Archivo | Quién es | Qué prueba |
| --- | --- | --- |
| `cv-1-sin-experiencia.txt` | Recién recibida en Relaciones Públicas, con voluntariado, pasantía y un proyecto de la facultad | Qué pregunta cuando hay poca experiencia; no tiene que inventar logros; viñetas vagas («Ayudé con las redes») |
| `cv-2-con-experiencia.txt` | Analista de compras con 3 trabajos en Administración de Empresas | Que conserve el «12 %» y «marzo 2021»; viñetas flojas («Tareas administrativas varias»); que no repregunte lo que ya está |
| `cv-3-cambio-de-carrera.txt` | De recepcionista de hotel a desarrolladora fullstack, con dos proyectos | Que los **proyectos** (con el link y las tecnologías) no se pierdan; que el orden muestre primero lo que sirve para el puesto nuevo |

### Cómo pasarlos a PDF
**Con Google Docs**
1. Abrí el archivo `.txt` y copiá todo el texto.
2. En Google Docs, creá un documento en blanco y pegá el texto.
3. Si querés, poné los títulos en negrita, como en un CV común.
4. Menú **Archivo → Descargar → Documento PDF (.pdf)**.

**Con Word**
1. Abrí Word, creá un documento en blanco y pegá el texto.
2. **Archivo → Guardar como → elegí «PDF»** en el tipo de archivo.
3. Para la prueba de Word, guardalo también como «Documento de Word (.docx)».

> Guardalos con un nombre que los distinga, por ejemplo «CV prueba 1.pdf».

---

## 6. Qué esperamos de esta prueba

- Que la lectura del PDF y las tarjetas no pierdan datos ni inventen.
- Que ninguna pregunta cruce la lista de la sección 4.
- Que el CV final se lea bien en un sistema de selección.
- La opinión de alguien de RR.HH. sobre el tono, el orden y si lo usaría con una persona que busca trabajo.

---

## 7. Comparación de Mauro: su CV actual contra el que arma AfinIAJobs

Mauro hace el mismo recorrido con **su CV real**, en su propia cuenta, y compara. **Ningún dato real va a este repositorio** (ni nombres, ni empresas, ni proyectos, ni capturas). La planilla y las capturas quedan en su máquina, en `fixtures-private/` o en su Drive. Para contarlo en un informe se usan nombres genéricos: «Empresa A», «Proyecto 1» a «Proyecto 4», «el cargo actual».

### Cómo hacerlo
1. Tené a mano tu CV actual en PDF.
2. Hacé el recorrido de la sección 2 desde `/cv` → «Subí tu CV y armamos tu perfil» (`/cv/perfil`).
3. Descargá el Word del CV que arma AfinIAJobs.
4. Poné los dos CV lado a lado y llená la planilla de abajo.

### Qué mirar
| Qué | Cómo se mira | Ejemplo (ficticio) |
| --- | --- | --- |
| **Datos perdidos** | Hacé una lista de cada dato atómico de tu CV (empresa, cargo, fechas, cada proyecto, cada número, cada estudio, cada idioma) y tachá los que aparecen en el nuevo. Lo que no se tacha se perdió. | «Proyecto 3» no aparece; «2 años» en «Empresa A» quedó sin el mes |
| **Viñetas con resultado** | Contá las viñetas que dicen qué lograste (un número, un antes y después) en los dos CV | Actual: 2 de 9 · Nuevo: 4 de 9 |
| **Proyectos** | ¿Están los cuatro? ¿Con link y tecnologías? ¿En una sección propia («Proyectos»)? | «Proyecto 2» sin link |
| **Orden** | ¿Lo más relevante para el puesto que buscás está arriba? En la prueba del 17/11 la docencia quedaba por encima de los proyectos. | La ayudantía de cátedra arriba del cargo actual |
| **Inventos** | Cualquier número, herramienta, empresa, título o logro que no estaba ni en tu CV ni en tus respuestas | «lideró un equipo de 5» sin haberlo dicho |
| **Preguntas repetidas** | En los huecos, ¿te preguntó algo que el CV ya decía o que ya habías contestado? | Volvió a preguntar las fechas de «Empresa A» |
| **Legible por ATS** | La misma prueba del Bloc de notas de la sección 4 | — |

### Planilla de comparación
| Dato de mi CV (con nombre genérico) | ¿Está en el nuevo? | ¿Igual, mejor o peor? | Nota |
| --- | --- | --- | --- |
| Empresa A · cargo actual · fechas | Sí | Igual | — |
| Proyecto 1 · link · stack | Sí, sin link | Peor | Se perdió el link |

**Resultado en una línea por métrica** (para el informe, sin datos reales): datos perdidos N de M, viñetas con resultado antes y después, proyectos N de 4, inventos N, preguntas repetidas N de M.

---

## 8. Lo que todavía no está (no se prueba el 20/11)

- **El coach de CV** (ADR-038, Fase 2 del plan): el diagnóstico de qué le falta a tu CV y la charla que lo mejora. Está detrás del interruptor `CV_COACH`, que sigue **apagado**. Si ves algo que diga «coach», avisale a Mauro.
- **La puerta «Tengo CV / No tengo CV» en `/cv`** (R12-6) puede no estar publicada todavía. Mientras tanto, la entrada es la tarjeta «Subí tu CV y armamos tu perfil».
- **Proyectos en el perfil y en el CV** (R12-4) y **la lectura de varios datos en una sola respuesta** (R12-2) son arreglos en curso. Si el 20/11 los proyectos se pierden o te repregunta algo que ya dijiste, anotalo igual: es justo lo que esos arreglos tienen que resolver, y la nota sirve para comprobarlo después.
- Un PDF de dos columnas puede salir con el texto en otro orden. Se corrige a mano en el cuadro antes de «Leer mi CV»; anotalo si pasa.

---

## 9. Para el equipo técnico

- Contrato y pruebas anteriores: [ADR-034](../adr/034-agente-de-perfil-desde-el-cv.md), [`agente-perfil-pruebas.md`](./agente-perfil-pruebas.md), y el plan en [`plan-coach-cv.md`](./plan-coach-cv.md).
- Preguntas prohibidas: `SENSITIVE_QUESTION_RE` en `packages/pipeline/src/cv-chat/follow-up.ts`. La lista de la sección 4 la traduce y suma los datos de contacto y de terceros de `agente-perfil-pruebas.md` §3.
- Lectura de PDF: R12-12 (`apps/web/components/profile-agent/extract-text.ts`, e2e 141).
- Costo esperado de la prueba: unos USD 0,08 por recorrido completo (`agente-perfil-pruebas.md` §5). Las cuentas tester no tienen tope de lecturas, pero sí rige el tope de USD 0,50 por persona y por día: con tres cuentas, alcanza de sobra.
- Las notas de la prueba van a `docs/beta/informe-r12.md` en el cierre de la tanda, sin datos reales.
