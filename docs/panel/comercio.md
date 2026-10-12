# Panel · `comercio`: principiante en transición desde comercio, rol QA

Persona sintética (ficha en `fichas.md`). Recorrido en la app local con datos ficticios y el LLM en modo demo. Lente: primer trabajo en tecnología. Las capturas no se versionan.

## Resumen
- Pudo hacer todo sola, en unos 6 minutos y sin ayuda. Lo que se trabó no fue la navegación sino lo que la app dice de las ofertas.
- No le sirvió para ver qué hay de entrada en QA:
  - las ofertas de la fuente eran senior o de datos;
  - sus 3 ofertas salieron "Descartar", con bloqueadores incomprensibles;
  - mercado y plan le recomiendan cosas ajenas a QA.
- Registro, onboarding y "Mis skills" andan bien. Cambió una skill y, a los 15 s, `/market` y `/plan` estaban actualizados.

## Hallazgos

### 1. Bloqueante · Criterios por defecto ajenos, sin QA ni soporte
- **Pantalla:** `/settings/criteria`.
- **Qué pasó:** ya había criterios que ella no puso:
  - disciplinas IA, Fullstack, Frontend, Backend y Arquitectura;
  - salario mínimo de 3000 USD y 8 años máximos;
  - títulos bloqueados y "palabras de otras disciplinas".
  En la lista de disciplinas no existen QA, Soporte ni Calidad.
- **Efecto:** las ofertas de QA y de soporte salen con "Disciplina distinta (otra)" como bloqueador y con el score recortado ("8 → 4 (discipline_cap -4)").
- **Arreglo:** al elegir el rol, generar los criterios de ese rol (o criterios neutros). Agregar QA, Soporte, UX y Análisis de datos a las disciplinas.

### 2. Bloqueante · Bloqueadores que contradicen la evaluación
- **Pantalla:** detalle de "Analista de Soporte Técnico Nivel 1" y de "Junior QA Engineer".
- **Qué pasó:**
  - En soporte, el veredicto dice "Excelente match con tu experiencia en comercio y atención", pero un bloqueador dice "años en otro dominio (atención al cliente o ventas)".
  - En QA sale "disciplina distinta (otra)" y "años en otro dominio (testing de software)".
  - Las dos muestran el botón verde "Marcar aplicada" junto a "acción: Descartar".
  - Riesgo de "45 horas semanales (excede tu límite de 40)" sin que ella haya puesto un límite, y el mismo dato aparece también como señal positiva.
- **Arreglo:**
  - no mostrar "Marcar aplicada" como botón principal cuando hay bloqueadores;
  - no repetir un dato en Riesgos y en Señales positivas;
  - bloqueadores en lenguaje llano, que digan qué tendría que cambiar.

### 3. Bloqueante · "Solo trabajo remoto" viene marcado y descarta su oferta local
- **Pantalla:** `/onboarding` y detalle de una oferta.
- **Qué pasó:** no tocó el casillero. "QA Tester Junior", híbrida en su ciudad, quedó "Descartada (prefiltro)" sin evaluar, con el motivo `modalidad_no_remota: modalidad hibrido`. En Ajustes no hay dónde editar el perfil (país, inglés, solo remoto, resumen).
- **Arreglo:**
  - casillero sin marcar, o pregunta explícita;
  - el motivo en llano: "Descartada porque buscás solo remoto. Cambialo en Ajustes";
  - edición del perfil en Ajustes.

### 4. Importante · Mercado y plan no están pensados para el rol
- **Pantalla:** `/market` y `/plan`.
- **Qué pasó:**
  - Las brechas de `/market` son SQL, ETL, Snowflake, AWS, Python y Azure.
  - `/plan` propone 26 a 29 skills y unas 504 h (Java, .NET, Go, Vue, NestJS, GCP). Testing queda casi al final.
  - Mesa de ayuda no aparece entre los diferenciales.
- **Arreglo:**
  - filtrar mercado y plan por la disciplina del rol;
  - mostrar los primeros 5 y plegar el resto;
  - arriba, "Para llegar a QA junior te faltan X cosas".

### 5. Importante · Jerga y códigos internos sin explicar
- **Pantalla:** `/jobs`, detalle, `/market` y `/plan`.
- **Qué pasó:**
  - etiquetas crudas: `location_risk`, `modalidad_no_remota`, `discipline_cap -4`;
  - categorías en inglés: framework, ai_core, infra, soft;
  - siglas: JD, pre-score, CEFR, sponsorship, ITSM, "Score mín.";
  - el modelo y la versión del prompt a la vista;
  - números sin unidad: "Demanda 25.0", "prioridad 22.7";
  - "~0 h para cerrar", que parece falso;
  - "Sin nivel cargado (3)".
- **Arreglo:**
  - diccionario de etiquetas en español;
  - "Descripción" en vez de "JD";
  - "sin estimación" en vez de "~0 h";
  - el modelo, dentro de un "Detalle técnico" plegado.

### 6. Importante · El buscador de skills no entiende cómo lo diría alguien que viene del comercio
- **Pantalla:** `/onboarding/skills?rol=qa`.
- **Qué pasó:**
  - "atención" y "cliente" no encuentran nada; solo "client" (en inglés) trae "Client-facing";
  - Help desk aparece solo escribiendo "help";
  - "excel" también trae "Inglés avanzado/fluido".
- **Arreglo:** sinónimos en español ("atención al cliente", "mesa de ayuda", "ventas"), nombre visible "Atención al cliente", y revisar por qué "excel" trae inglés.

### 7. Importante · `/jobs` sin guía cuando no hay ofertas del rol
- **Pantalla:** `/jobs`.
- **Qué pasó:** 7 ofertas de la fuente, todas senior o de datos y todas "Evaluando…". No hay aviso que la mande a cargar las suyas, ni explicación de qué es el score.
- **Arreglo:** banner hacia "nueva oferta"; "Score: de 0 a 10, qué tan bien encaja con tu perfil".

### 8. Importante · En el celular (390 px) se cortan el encabezado y la barra de secciones
- **Pantalla:** `/jobs`, detalle y `/jobs/new`.
- **Qué pasó:** "Salir", "Postulaciones" y "nueva oferta" quedan cortados al borde. La barra se desplaza sin pista de que hay más. Los títulos de las ofertas se cortan con "…".
- **Arreglo:** menú compacto o barra en dos renglones; títulos en 2 líneas (`line-clamp-2`).

### 9. Pulido · El error de resumen corto depende del navegador
- **Pantalla:** `/onboarding`.
- **Qué pasó:** se conserva lo cargado, pero el aviso es el genérico del navegador.
- **Arreglo:** contador "29/80" debajo del campo.

### 10. Pulido · El asistente de email no dice para qué sirve
- **Pantalla:** `/onboarding/asistente`.
- **Arreglo:** "Es opcional: sirve para que te lleguen ofertas solas", y "Lo hago después" arriba.

### 11. Pulido · Mejorar una skill sube su prioridad en el plan
- **Pantalla:** `/plan`.
- **Qué pasó:** testing de nivel 1 a 2: la prioridad pasó de 2,2 a 3,1 y las horas de 16 a 8. Parece al revés.
- **Arreglo:** explicar el cálculo con un ejemplo, o mostrar "ahora te falta menos".

### 12. Pulido · Textos del onboarding
- **Qué pasó:**
  - no dice que 0 años es válido;
  - "sin sponsorship" no se explica;
  - en Mis skills, "Otras skills que ya cargaste" confunde porque no muestra el rol.
- **Arreglo:** ayudas breves por campo.

## Lo que funcionó bien
1. Registro con invitación y login: pocos campos y mensajes claros.
2. Los 4 niveles en palabras son perfectos para alguien que empieza.
3. Cambiar una skill se refleja en mercado y plan en unos 15 s, y el aviso lo anticipa.
4. Pegar una oferta es rápido y la evaluación aparece sola.
5. La estructura de la evaluación es buena idea; falla por los datos que la alimentan (1 a 3).
