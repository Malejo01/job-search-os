# Panel · `bootcamp`: dev junior de bootcamp, rol Full-stack

Persona sintética (ficha en `fichas.md`). Recorrido en la app local con datos ficticios y el LLM en modo demo. Lente: dev junior que tiene que decidir a qué postularse. Las capturas no se versionan. Cargó 3 de sus 5 JDs.

## Resumen
- Pudo hacer todo sola (registro, perfil, skills, 3 JDs, mercado, plan y ajustes) en unos 6 minutos, pero con confusión en varias pantallas.
- **Lo que sirve:** el score y la evaluación de cada oferta la ayudan a decidir.
- **Lo que no:** el pre-score, el prefiltro, `/market` y `/plan` no la ayudaron, y en dos casos le dieron un dato equivocado.
- **Textos técnicos:** a medias. Algunos están bien traducidos; otros salen como código interno.

## Hallazgos

### 1. Bloqueante · Su única oferta local quedó descartada por "solo remoto"
- **Pantalla:** detalle de la JD 1, "Full-stack Junior" híbrida en su ciudad.
- **Qué pasó:** "Descartada (prefiltro)" con el motivo `modalidad_no_remota: modalidad hibrido`. El onboarding había dejado marcado "Busco solo trabajo remoto" sin preguntarle. No hay "evaluar igual", y en Ajustes no se puede cambiar el casillero ni el país, el inglés o los años.
- **Arreglo:**
  - casillero sin marcar o con ayuda;
  - "Perfil" en Ajustes;
  - "Evaluar igual" en las descartadas;
  - motivo en llano.

### 2. Bloqueante · El pre-score es engañoso antes de la evaluación
- **Pantalla:** detalle de la JD 3 (Mid-level, 3+ años, solo EE. UU., inglés nativo).
- **Qué pasó:** el pre-score muestra 7, más alto que el 6,5 de una JD junior. Sus riesgos solo dicen "ubicación con riesgo". Cuando corre el modelo, el score baja a 5 y aparecen el bloqueador y los riesgos correctos. Ese lapso (20 a 30 s, o más si el modelo falla) es engañoso.
- **Arreglo:** que el pre-score aplique los mismos chequeos de años, inglés y país, o que no muestre número hasta la evaluación, o que diga "provisorio, sin revisar años ni inglés".

### 3. Importante · La evaluación contradice al pre-score y al perfil
- **Pantalla:** detalle de la JD 2, score 8,5, "Aplicar".
- **Qué pasó:** la evaluación dice "Match fuerte: Next.js" (ella marcó "hice un tutorial o curso") y "Gaps: TypeScript (must)" (marcó "lo usé en un proyecto"). El pre-score decía lo contrario. Puede ser un efecto del LLM en modo demo: verificar con el modelo real.
- **Arreglo:** pasarle al evaluador los niveles de skills; mostrar el nivel al lado de cada skill.

### 4. Importante · El desglose del pre-score está en código interno
- **Pantalla:** sección de pre-evaluación.
- **Qué pasó:**
  - "pre-score 6.5" sin escala;
  - "cobertura +4.5, riesgo_location_risk -1";
  - menciona un salario de referencia que ella no cargó;
  - "Tenés (3)" sin nivel.
- **Arreglo:** "6,5 / 10", etiquetas traducidas, ocultar lo del salario si no hay dato.

### 5. Importante · `/market` no ayuda a una full-stack junior
- **Pantalla:** `/market`.
- **Qué pasó:**
  - los gaps son de datos y cloud (ETL, Snowflake, AWS, Azure, Python) más "Client-facing", y vienen de ofertas de la fuente, casi todas senior;
  - "Diferenciales: nada";
  - "sin dato" es ambiguo;
  - "Demanda 15.0" no tiene unidad.
- **Arreglo:**
  - filtrar por rol;
  - "Nunca lo usé" en vez de "sin dato";
  - explicar la demanda;
  - avisar si hay pocas ofertas junior en la muestra.

### 6. Importante · `/plan` es un bloque de 28 a 33 skills
- **Pantalla:** `/plan`.
- **Qué pasó:**
  - unas 507 h, que pasan a 712 h tras guardar;
  - incluye lo que ya usa (TypeScript, Node.js, SQL en nivel 2) con "~0 h para cerrar";
  - muchas skills "sin recurso aprobado";
  - skills de IA y de datos ajenas al rol;
  - categorías crudas;
  - 3 botones por tarjeta, demasiado en el celular.
- **Arreglo:** "Top 3 para empezar" con el resto plegado; excluir nivel 2 o más; ocultar "~0 h"; traducir categorías.

### 7. Importante · Tras guardar, el plan crece sin explicar por qué
- **Pantalla:** Mis skills → `/plan`.
- **Qué pasó:** el guardado y la actualización funcionan (`/market` cambió en 15 s), pero el plan pasó de 28 a 33 skills y sumó horas sin aviso.
- **Arreglo:** "se agregaron N skills por tus ofertas nuevas" o la fecha de la última actualización.

### 8. Importante · Mis skills no recuerda el rol
- **Pantalla:** `/settings/skills`.
- **Qué pasó:** al volver no hay rol marcado y sus skills quedan bajo "Otras skills que ya cargaste", en orden alfabético.
- **Arreglo:** guardar el rol objetivo.

### 9. Importante · La pantalla de skills es muy larga en el celular
- **Pantalla:** `/onboarding/skills`.
- **Qué pasó:** 12 bloques de 4 radios, unos 3.300 px. Los botones quedan al final.
- **Arreglo:** 4 chips por fila o una barra fija con "Guardar y seguir".

### 10. Importante · `/jobs` en el celular se corta
- **Pantalla:** `/jobs`.
- **Qué pasó:**
  - "Salir" tapado;
  - el menú con scroll horizontal oculta Mercado y Plan;
  - el select "Fuente" se sale de la pantalla;
  - títulos truncados.
- **Arreglo:** menú en dos renglones o hamburguesa; selects en una columna; `line-clamp-2`.

### 11. Importante · Ofertas de la fuente: todo senior, "Evaluando…" por más de un minuto
- **Pantalla:** `/jobs`.
- **Qué pasó:** "0 de 1 oferta verde en total revisada" no se entiende, y falta un filtro por seniority.
- **Arreglo:** filtro de seniority; "Revisaste 0 de 1 ofertas con score alto".

### 12. Pulido · El registro no precarga el email de la invitación
- **Qué pasó:** el email está vacío, no hay "ver contraseña" y después de crear la cuenta hay que volver a entrar con todo.
- **Arreglo:** email precargado y bloqueado; entrar directo.

### 13. Pulido · Pantalla en blanco al entrar
- **Qué pasó:** unos 3 s en blanco en `/jobs` antes de ir a `/onboarding`.
- **Arreglo:** redirigir desde el servidor o mostrar un esqueleto.

### 14. Pulido · Error de resumen corto sin contador
- **Qué pasó:** se conserva lo cargado, pero el aviso es el del navegador.
- **Arreglo:** contador "25/80".

### 15. Pulido · Onboarding
- **Qué pasó:** el campo "Otro país" está siempre visible, y el salario y las horas opcionales no dicen para qué sirven.
- **Arreglo:** mostrar el campo solo con "Otro"; ayuda de una línea.

### 16. Pulido · Jerga en el detalle
- **Qué pasó:**
  - "Score humano (0–10)" y "por qué difiere del modelo";
  - "Empresa desconocida" como riesgo;
  - "(must)";
  - "Cerrar" en una oferta descartada sin decir qué hace.
- **Arreglo:** "Tu puntaje (opcional)", "(obligatorio)" y una ayuda en "Cerrar".

### 17. Pulido · El asistente de email asume Gmail
- **Arreglo:** una frase de beneficio arriba y la salida "No uso Gmail".

### 18. Pulido · Criterios de fábrica altos para una junior
- **Pantalla:** `/settings/criteria`.
- **Qué pasó:** 3000 USD de salario de referencia y 8 años máximos, que ella nunca cargó. Las ofertas marcan "Salario no publicado" como riesgo.
- **Arreglo:** vacío si no lo cargó, o preguntarlo con un ejemplo.

## Lo que funcionó bien
1. La evaluación completa, con "se ven, no frenan" frente a "frenan la postulación".
2. En la JD 3, el modelo detectó bien años, inglés y autorización contra el perfil.
3. Guardar skills tiene un mensaje claro y el mercado se actualizó en 15 s; los niveles en palabras son fáciles.
4. Registro y login sin trabas. Los errores conservan lo cargado. La ayuda "Qué poner / Qué no poner" está muy bien.
5. En escritorio, `/market` es legible y la navegación anterior/siguiente es cómoda.

**Nota de entorno:** el botón de herramientas de Next.js (solo en desarrollo) tapa contenido en el celular.
