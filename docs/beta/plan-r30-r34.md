# Plan R30 a R34 · del informe de Ani a la beta (26/11)

Este documento es la **especificación vigente** de las tandas R30 a R34. Junta en un solo lugar lo que el responsable del proyecto decidió sobre el informe de revisión de Ani (159 puntos: R-01 a R-38, S-01 a S-49 y C-01 a C-72) y los 13 cambios de la revisión de coherencia, que aprobó completos el 26/11. Si algo de acá choca con una decisión anterior, vale lo de acá.

- **El informe de Ani** está en `ops/rondas/r30-tanda/informe-ani.pdf` (privado, no va al repo). Cuando este plan dice «tal cual el informe», el texto exacto sale de ahí, por ID.
- **Los tickets** están en `docs/beta/prompt-r30.md` a `prompt-r34.md`. La mecánica de la cadena, en `docs/beta/cadena-r30-r34.md`.
- **La lista de verificación** por ID vive en `docs/beta/verificacion-informe-ani.md`. La crea la R30 y la actualiza cada tanda.

## 1. Lo que el código ya resuelve (verificado en `main`)

- **La tabla única de requisitos ya existe** y la arma el código, no el modelo: `packages/pipeline/src/evaluator/checklist.ts`. Tiene tres estados (`cumple`, `no_cumple`, `no_se_sabe`), nivel (`must` o `deseable`), fuente y evidencia. Regla escrita: el modelo nunca dice «cumple».
- **Las contradicciones que vio Ani** salen de los paneles que rodean a esa tabla: `packages/pipeline/src/fit/fit-points.ts` mezcla bloqueadores, gaps, riesgos y datos faltantes, y el prescore de habilidades cuenta aparte.
- **El puntaje no baja por condiciones** (residencia, autorización, modalidad, salario): un 8 puede convivir con un bloqueador que manda a «descartar» (`packages/pipeline/src/decide.ts`).
- **«Muchos candidatos»** es una opción de la lista cerrada de `riesgos` del prompt `evaluate_job` v1.4.0. Solo hay un dato detrás cuando el aviso trae `candidatesCount`.
- **R-35 ya está hecho:** `apply-button.tsx` abre el aviso y pregunta al volver; solo marca con un «sí».
- **«Corregir el puntaje»** guarda `human_score` y `human_note`. No cambia el puntaje que se ve.
- **El filtro «cerca»** busca la ciudad del perfil en `location_raw`. Ya existe el filtro `idioma`.
- **CV:** el coach (ADR-038) solo cubre «Tengo CV». «No tengo CV» va al chat de `/cv/armar`. El modelo de salida ya admite LinkedIn, GitHub, portfolio, titular y resumen. El DOCX sale en A4. «Guardar como PDF» abre la impresión del navegador.
- **Legibilidad:** los colores de texto pasan AA. Hay textos de 9 a 11 px (sellos y chips) y unos 20 con transparencia. Los botones ya miden 44 px.
- **El sueldo se guarda en dólares** (`salary_min_usd`, `salary_max_usd`), sin la moneda original.

## 2. Reglas de toda la app

1. **«Sin confirmar» no es «No coincide».** «Sin confirmar» es cuando el perfil no tiene el dato. «No coincide» solo cuando el perfil tiene un dato explícito distinto. Nunca «te falta».
2. **Nada predice ni compara.** Fuera «quedar entre las mejores», «lo primero por lo que te descartarían», «posible alta cantidad de candidatos» (salvo que el aviso traiga el número) e «impide postular».
3. **Lo que el aviso no dice queda «No especificado».** No se deduce nada: remoto no es horario flexible ni «desde cualquier país».
4. **Nada se marca solo** como postulado.
5. **Aclaración fija** en la evaluación: «Esta comparación usa la información del aviso y de tu perfil. No indica tus posibilidades de contratación.»
6. **El CV nunca suma datos** que la persona no declaró, y ninguna sugerencia entra sin que la marque.
7. **Los estados llevan texto e ícono,** nunca solo color. Nada de tildes verdes y cruces rojas grandes para un «Sin confirmar».
8. **Nada se envía desde la app** ni se navega ningún portal (ADR-004).

## 3. Glosario único (con test)

| Se dice | No se dice | Dónde |
|---|---|---|
| **oferta** | — | lo que la persona ve en AfinIA Jobs |
| **aviso** | publicación, anuncio | el original, en el sitio de donde salió |
| **afinidad** | match, compatibilidad, encaje, puntaje de encaje | sello, detalle, emails |
| **Coincide · Sin confirmar · No coincide** | cumple, te falta, falta confirmar, no cumple | estado de cada requisito |
| **habilidades** | skills, aptitudes | toda la interfaz |
| **Ya me postulé** | Aplicada | pestañas, estados, emails |
| **Guardada** | favorita | marca de la oferta |
| **Sin evaluar** | Estimado, Por confirmar | cuarto sello |
| **No especificado** | Sin datos, N/D, — | lo que el aviso no dice |

El resto de los textos nuevos del listado y de la evaluación son **los de las tablas de Ani, tal cual** (R-10 a R-12 y S-07 a S-14, S-30), salvo donde este glosario diga otra cosa. Todos van a `apps/web/lib/textos-rediseno.ts` para que Ani los apruebe.

## 4. Afinidad y sellos

- **Se mantiene el puntaje de 0 a 10** que da la evaluación.
- **Cuatro sellos:** «Afinidad alta» desde 7, «Afinidad media» de 5 a 6,9, «Afinidad baja» debajo de 5 y «Sin evaluar» cuando todavía no hay evaluación.
- **El número va siempre al lado, con un decimal y coma:** «Afinidad alta · 7,4/10». Así el número nunca contradice al sello (un 6,9 no se muestra como 7).
- **«Cómo calculamos la afinidad»** explica qué sale del aviso, qué del perfil y qué está sin confirmar.
- **Condición excluyente que no coincide** (una fila `must` con `no_cumple` que bloquea):
  - en la tarjeta va arriba, con texto e ícono: «No coincide: residencia en EE. UU.»;
  - la oferta baja en el orden del listado;
  - en el detalle se explica **aparte** de la afinidad: la afinidad compara el perfil con el puesto, y la condición es un requisito del aviso que hoy no coincide.
- **Antes de evaluar:** sello «Sin evaluar», botón «Evaluar esta oferta» y una «Estimación provisoria (sin IA)» chica y plegada, sin el número como protagonista. Cuando hay evaluación, la estimación desaparece: nunca hay dos puntajes a la vista.

## 5. Listado, tarjeta y filtros

- **Pestañas:** Por revisar · Guardadas · Ya me postulé · Descartadas · Todas.
- **«Guardada» es una marca con fecha** (`saved_at`), no un estado. Una oferta guardada sigue en «Por revisar» con su marca, y además aparece en «Guardadas».
- **Tarjeta:** puesto, empresa, modalidad y sello con número. Además:
  - el salario, solo si el aviso lo publica, con moneda y periodicidad;
  - una línea «Sin confirmar: …» con hasta 2 cosas, sacada de la tabla de requisitos;
  - los botones «Ver oferta», «Guardar» y «Descartar»;
  - sin resumen generado por IA y sin repeticiones («Tenés: …», «Empresa A, remoto · Remoto»).
- **Vigencia:** si el aviso del pool ya no está publicado, la tarjeta y el detalle dicen «Este aviso ya no figura en {fuente}». De las ofertas que no vienen del pool no se afirma nada.
- **Chips de filtro,** debajo de las pestañas, cada uno con su número: Remoto · En {tu ciudad} · Aceptan {tu país} · En español · Para empezar · Orden.
  - «Aceptan {tu país}» incluye los avisos que nombran el país, su región o todo el mundo de forma explícita. Los que no dicen países **no entran**.
  - El chip activo va marcado y con ×. Contador real («24 ofertas con estos filtros»), «Limpiar filtros», estado de carga y estado vacío con el texto de Ani.
- **Botón de carga:** «+ Agregar una oferta», con la aclaración «Traé un aviso que viste en otro sitio y lo evaluamos».
- **Descartadas, tal cual el informe** (R-20 a R-23): fondo neutro y legible, «Descartada por vos», «Volver a revisar», «Ver oferta», aviso «Oferta descartada. [Deshacer]», nada tachado.

## 6. Detalle de la oferta

Orden, igual en la computadora y en el celular:

1. **Encabezado:** puesto, empresa, modalidad, fecha, salario si está publicado, desde dónde se puede trabajar y el sello chico.
2. **La oferta en pocas palabras** (2 o 3 frases, en español).
3. **Lo importante para decidir:** siempre las 7 filas (modalidad, desde dónde podés trabajar, salario, experiencia, inglés, jornada y tipo de contratación), con «No especificado» cuando falta. Muestra lo que pide el aviso, nunca mezclado con el perfil.
4. **Cómo encaja:** el veredicto y hasta 3 cosas que más pesan, sacadas de la tabla de requisitos. Si algo se repite en varias ofertas: «Esto mismo te pasa en N de tus M ofertas», con un botón que abre solo ese campo.
5. **Qué vas a hacer.**
6. **Qué buscan** (indispensable y deseable, solo si el aviso los distingue).
7. **La evaluación completa,** en secciones plegables: «Requisitos» abierta; «Habilidades», «Cómo se calculó» y «Preparar mi postulación» plegadas.
8. **Un solo botón de salida:** «Ir a postularme en {sitio} ↗», arriba y fijo en el celular, con «Vas a continuar en un sitio externo. Tu postulación no se envía desde AfinIA Jobs».

Además:

- Los bloques 2, 5 y 6 salen de la **ficha del aviso** (sección 8). Hasta que exista la ficha de una oferta, no se muestran.
- **Sin traducción completa.** «Ver descripción original» queda a un toque.
- «Conocé la empresa» (R-27) queda para después de abrir.
- **Habilidades:** solo las ligadas al puesto, marcadas «Mencionada en el aviso», con el nivel de la persona o «Sin cargar» y su botón una sola vez. Una línea aclara que no cuentan en el puntaje principal. Fuera «cobertura 100 %», «+6» y la lista duplicada de «Sin nivel cargado».
- **«¿Te sirve esta evaluación?»:** «Sí» muestra solo «Gracias». «No» abre «Leyeron mal un requisito», «El puntaje no me parece justo», «Falta algo importante» y «Otro», con texto opcional y la línea «Nos ayuda a mejorar la evaluación; no cambia tu puntaje».
- **«Proponer otro puntaje»** (antes «Corregir el puntaje») lo ven solo testers y admins.
- Un ⓘ con una o dos líneas en cada término técnico: excluyente, estimación provisoria, ajustes.

## 7. Preparar mi postulación

Una sola sección, con ese nombre, que junta lo que hoy está repartido:

- **El formulario:** «Pegá las preguntas del formulario, revisá los borradores y copiá lo aprobado. Nada se envía desde acá. La postulación la hacés vos, en el sitio del aviso». Los borradores usan solo datos del perfil y marcan los huecos («[completá con tu ejemplo]»).
- **Hasta 5 pasos finales,** solo los que aplican.
- **El CV para esta oferta** (R34): «Revisar mi CV para esta oferta», «Adaptar a esta oferta» y elegir la versión para descargar.
- **El botón de salida** de la sección 6. Al volver, la pregunta «¿Pudiste postularte?» sigue igual.
- Se elimina «Ver detalle completo». «Ver el aviso original» queda como enlace de texto solo si lleva a otro lugar que el botón.
- El aviso de suscripción de We Work Remotely se muestra solo si está confirmado.

## 8. Ficha del aviso y evaluación (R31)

- **Una sola ficha por descripción.** La clave es el hash del texto del aviso. Sirve para todas las personas y también para las ofertas que no están en el pool (alertas por email y avisos pegados).
- **Qué trae:** resumen, tareas, requisitos (con nivel indispensable, deseable o sin distinguir), las 7 condiciones, habilidades ligadas al puesto, área e idioma. **Cada dato lleva su cita literal del aviso.**
- **El código verifica cada cita** contra el texto. Lo que no verifica se descarta (falla cerrado).
- **Cuándo corre:** en el ingreso, solo para los avisos que pasan el prefiltro de alguna persona; a pedido, la primera vez que alguien abre el detalle («Preparando el resumen…»); y siempre antes de evaluar. No hay pasada sobre todo el pool.
- **Sin descripción suficiente:** «Pegá la descripción para ver el resumen».
- **La tabla de requisitos suma filas `req:<n>`** con lo que pide el aviso según la ficha. **El estado lo decide el código,** comparando con el perfil. Lo que no se puede comparar queda «Sin confirmar» y ofrece una pregunta de un toque (Sí, No o En parte) que se guarda en el perfil.
- **Autorización de trabajo y residencia van en dos filas distintas.** El inglés, una sola vez. El área del puesto es un dato del aviso, nunca un requisito cumplido.
- **`evaluate_job`, versión nueva:** sirve para cualquier carrera y para avisos locales (hoy habla de tecnología y trabajo remoto), usa la ficha y no marca «muchos candidatos» salvo que el aviso traiga el número. El puntaje sigue sin bajar por condiciones.
- **Los conteos, «lo que más pesa» y la línea de la tarjeta** se calculan en `packages/pipeline` desde la tabla. No los escribe el modelo.
- **Reevaluación:** cuando la versión nueva esté promovida, las ofertas abiertas se reevalúan una sola vez, para no convivir con dos formatos.

## 9. Legibilidad

- **Tamaños:** cuerpo 16 px, secundario mínimo 14 px y 12 px solo para metadatos que se pueden ignorar. **Nada debajo de 12 px.**
- **Colores:** se mantiene la paleta. Sin transparencias en textos. Lo necesario para decidir no va en el gris más claro ni en 12 px. Los ejemplos de los campos vacíos se distinguen de lo cargado.
- **Tokens documentados** (primario, secundario, deshabilitado) y una regla de lint o un test que falla si aparece un tamaño o un color de texto fuera de la lista.
- **Auditoría automática:** un script recorre las pantallas en claro y oscuro, a 390 y 1280 px y con zoom al 200 %, y lista lo que no cumple con capturas. Después lo revisa una persona de diseño.
- **Alcance:** ofertas en la R30, CV en la R33 y el resto de las pantallas de usuario en la R34. Todo eso entra antes de abrir. El admin va después.

## 10. Inventario y alta (R32)

- **Foco:** primero lo local y en español, para las 8 carreras de la beta.
- **La beta abre por carrera.** Una carrera abre cuando tiene al menos **30 ofertas vigentes tomables** y **10 para quien empieza**. La decisión la toma el responsable mirando el panel; nada abre solo.
  - **Vigente:** la fuente la mostró en los últimos 7 días.
  - **Tomable:** una persona en Argentina la puede tomar. El aviso acepta Argentina, su región o todo el mundo de forma explícita, o el lugar de trabajo está en Argentina. Si no dice países, no cuenta.
- **Carrera obligatoria** en el alta.
- **Estado vacío por carrera** y una guía para crear alertas por email, que la persona arma por su cuenta en cada portal.
- **Sueldo en la moneda original,** con su periodicidad. Nunca se convierte sin decirlo.
- **Fuentes para prender:** Computrabajo (lector de alertas), Jooble y ReliefWeb (necesitan clave), y empresas regionales en los adaptadores que ya existen.

## 11. CV (R33)

- **En la beta:** el coach para «Tengo CV» y el chat de `/cv/armar`, arreglado, para «No tengo CV». El informe se aplica en los dos.
- **Borrador automático.** Texto: «Guardamos un borrador para que no pierdas nada. Nada entra a tu CV hasta que lo confirmes». Se borra a los 30 días y al eliminar la cuenta. «Tu CV» muestra «Tenés un borrador sin confirmar. [Retomarlo]».
- **Botones del asistente, tal cual el informe** (C-06 a C-14).
- **Pantalla «Tu CV», tal cual** (C-01, C-02, C-04): tres estados, cada faltante con su botón al campo exacto.
- **Preguntas nuevas** (C-15 a C-20): «Resumen profesional» y habilidades blandas por situaciones, entre 2 y 4 como máximo.
- **Revisión «Esto es lo que entendí», tal cual** (C-26 a C-35).
- **Diagnóstico** (C-36 a C-42): palabra y número entero. «Sólido · 9/10» (8 a 10), «En camino · 6/10» (5 a 7), «Para reforzar · 3/10» (1 a 4) y «Sin empezar · 0/10». Frase fija: «Estos niveles miden cómo lo lee un sistema automático. No miden si sos buen o buena candidata».
- **PDF real** generado en el servidor desde el mismo modelo que el DOCX (C-48 a C-55): «Descargar PDF», archivo `CV-Nombre-Apellido.pdf`, A4, texto seleccionable.
- **Contacto y links** (C-43 a C-47): marcado lo que la persona cargó, salvo el teléfono.
- **Calidad del CV, tal cual** (C-56 a C-62 y C-64 a C-69).

## 12. Queda para después de abrir

- Sugerencias por rubro con lista curada (C-21 a C-25) y forma del cargo (C-63): cuando haya una cantidad decente de ofertas por carrera.
- «Conocé la empresa» (R-27), el coach desde cero, `/market` completo, el tablero de seguimiento, las páginas públicas por carrera y The Muse.
- El barrido de legibilidad del admin.

## 13. Tandas

| Tanda | Nombre | Qué entra | Modelos |
|---|---|---|---|
| **R30** | Confianza | Glosario, sellos, listado, tarjeta, filtros, descartadas, «Guardada», vigencia, detalle y evaluación sobre la tabla que ya existe, «Preparar mi postulación», valoración, base de legibilidad y parser de sueldo | Ninguno |
| **R31** | Ficha del aviso | Ficha, detalle en español, tabla con filas del aviso, `evaluate_job` nueva, patrón repetido y reevaluación | Simulado. Todo detrás de una variable apagada |
| **R32** | Inventario y alta | Carrera obligatoria, panel de cobertura, apertura por carrera, guía de alertas, fuentes, sueldo en moneda original y email de novedades | Ninguno |
| **R33** | CV | Todo el bloque del CV de la sección 11 y su legibilidad | Simulado. Prompts nuevos sin promover |
| **R34** | Barrido y cierre | Legibilidad del resto de la app, CV desde la oferta, `/market` mínimo y ensayo de punta a punta | Ninguno |

## 14. Compuertas y lo que depende de personas

**Compuerta A · abre la primera carrera.** Hace falta: la R30, la R31 y la R32 en `main`; al menos una carrera sobre el umbral; ninguna contradicción en la evaluación; ningún aviso vencido sin avisar; todo usable a 390 px; las evals en verde, y la checklist de apertura completa.

**Compuerta B · beta completa.** Hace falta: la R33 y la R34 en `main`; el CV de punta a punta; un ensayo con 5 personas en el que al menos 4 completan el recorrido, y la legibilidad revisada en toda la app de usuario.

**Lo que ninguna tanda hace sola:**

| Quién | Qué | Para qué tanda |
|---|---|---|
| Responsable | Integrar cada tanda, aplicar las migraciones en Neon y mergear el carril rojo | Todas |
| Responsable | Correr las evals de `evaluate_job` y de la ficha, promover los prompts y prender las variables | R31, R33 |
| Responsable | Aprobar el gasto de la reevaluación única | R31 |
| Responsable | Registrar las claves de Jooble y de ReliefWeb | R32 |
| Ani y responsable | Marcar entre 20 y 30 ofertas para calibrar la evaluación nueva | R31 |
| Ani | Crear las alertas de Computrabajo por carrera y aprobar los textos | R32, todas |
| Ani | Probar el coach y el chat del CV | R33 |
| Diseño | Revisar la auditoría de legibilidad | R30, R33, R34 |
| Ani | Conseguir 5 personas para el ensayo | Compuerta B |
