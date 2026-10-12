# Panel · `uxui`: diseñadora UX/UI con 3 años

Persona sintética (ficha en `fichas.md`). Recorrido en la app local con datos ficticios y el LLM en modo demo, en el celular (390 × 844) y en escritorio (1280 × 800). Lente: profesional de diseño. Las capturas no se versionan; los números entre paréntesis las nombran. No se probó el modo oscuro: el MCP no emula el esquema de color.

## Resumen
- Completó todo sola en unos 7 minutos. El alta, el onboarding, las skills y la carga de JDs son fluidos.
- Le sirvió a medias. Sus 3 JDs de diseño salieron bloqueadas por "disciplina distinta" por un criterio de fábrica que no contempla su oficio, y el veredicto le dio un motivo falso. Así, a una diseñadora no le sirve.
- **Lo bueno:**
  - el catálogo de skills de UX/UI es correcto (es la ronda 31: Figma, Investigación UX, Design systems, Prototipado y Accesibilidad);
  - `/market` y `/plan` se actualizaron después de guardar.

## Hallazgos

### 1. Bloqueante · Una oferta de diseño sale bloqueada por "disciplina distinta"
- **Pantalla:** detalle de "Diseñadora/or UI con Sistema de Diseño", "Product Designer (Remoto LATAM)" y la de investigadora UX; origen en `/settings/criteria` (`13`, `14`, `19`).
- **Qué pasó:** score 4, "Descartar" y bloqueadores "disciplina distinta (creative_production)" y "años en otro dominio". Los textos se contradicen:
  - el veredicto dice "tu disciplina objetivo es de desarrollo/ingeniería";
  - el resumen dice "El rol encaja excelente", con "discipline_cap -4".
  En los criterios no existe "Diseño / UX/UI" (lo más cercano es "Producción creativa con IA"), y elegir el rol UX/UI en skills no toca las disciplinas.
- **Arreglo:**
  - las disciplinas de los criterios salen del rol;
  - agregar "Diseño UX/UI";
  - con bloqueadores, "Marcar aplicada" en variante secundaria y el motivo junto al botón.

### 2. Bloqueante · El texto de un requisito aparece como "dominio" en un bloqueador
- **Pantalla:** detalle de la JD de sistema de diseño (`13`).
- **Qué pasó:**
  - "años en otro dominio (Experiencia con sistemas de diseño y tokens)" copia el requisito como si fuera un dominio;
  - en otra oferta, "(creative_production)";
  - la UX Researcher sale con "disciplina distinta (otra)".
- **Arreglo:** mapear los valores internos a castellano ("Tus 3 años de diseño no cuentan como los años de desarrollo que se piden") y no inyectar el texto del requisito.

### 3. Bloqueante · La oferta híbrida en su ciudad se descarta y no se puede rescatar
- **Pantalla:** detalle de "Diseñadora/or UX/UI" híbrida (`12`).
- **Qué pasó:** "Descartada (prefiltro)", sin score ni evaluación, y la única acción es "Cerrar". El casillero de solo remoto venía marcado. Además, la página prioriza un formulario de postulación enorme sobre una oferta descartada.
- **Arreglo:** "Evaluar de todos modos"; ocultar el formulario sin evaluación; motivo en castellano con link a donde se cambia.

### 4. Importante · No hay dónde editar el perfil
- **Pantalla:** `/settings` (`18`).
- **Qué pasó:** el onboarding dice "Los podés cambiar más adelante", pero Ajustes no tiene "Perfil".
- **Arreglo:** sección "Perfil" que reuse el formulario del onboarding.

### 5. Importante · El error de resumen corto es solo el globo del navegador
- **Pantalla:** `/onboarding` (`04b`).
- **Qué pasó:** el globo desaparece al hacer clic. No hay contador. El botón rojo "Eliminar mi cuenta" se ve durante el onboarding.
- **Arreglo:** contador con `aria-live` y borde rojo; "Eliminar mi cuenta" con menos peso o en Ajustes.

### 6. Importante · Pre-score de 8 antes de evaluar una oferta que pide 8+ años y EE. UU.
- **Pantalla:** detalle de la JD de investigadora mientras evalúa (`15`).
- **Qué pasó:** "pre-score 8", "Te faltan (0)" y "cobertura 100 %", calculado solo con 3 skills mapeadas. A los 20 s, el score final fue 2 con 4 bloqueadores.
- **Arreglo:** no mostrar número (o aclarar "solo skills") y mostrar de entrada los riesgos de años y ubicación.

### 7. Importante · "País no permitido (US only)" figura como riesgo y no como bloqueador
- **Qué pasó:** la etiqueta dice "Ubicación: no", pero aparece entre los riesgos que "no frenan".
- **Arreglo:** pasarlo a bloqueadores.

### 8. Importante · `/market` y `/plan` muestran demanda de datos y desarrollo, no de diseño
- **Pantalla:** `/market` y `/plan` (`16`, `17`, `22`, `23`).
- **Qué pasó:**
  - **al entrar:** gaps SQL, ETL, Snowflake, AWS, Python y Azure; el plan, 27 skills y unas 520 h;
  - **con sus JDs:** aparecen Design systems (gap) y Figma y Accesibilidad (diferenciales); el plan sube a 32 skills y unas 768 h, con SQL primero y más de 20 "sin recurso aprobado".
- **Arreglo:**
  - filtrar por las skills del rol, con un interruptor "ver todo el mercado";
  - estado vacío honesto si no hay demanda del rol;
  - no mostrar el total de horas.

### 9. Importante · HTML y CSS no están en la taxonomía
- **Pantalla:** búsqueda en skills y "Candidatos a skill nueva" (`07`).
- **Qué pasó:** "html" y "css" no encuentran nada, pero la evaluación muestra "HTML/CSS" como match fuerte y `/market` los propone como candidatos, junto con ruido ("PTO", "hrs").
- **Arreglo:** agregar HTML/CSS (y quizás Storybook como skill propia) y filtrar "PTO" y "hrs" de los candidatos.

### 10. Importante · Las skills cargadas no se conectan con los gaps
- **Qué pasó:** "Accesibilidad (must)" figura como gap aunque la cargó en nivel 2 antes de cargar la oferta.
- **Arreglo:** mostrar el nivel actual al lado de cada gap ("Tenés nivel 2; piden avanzado").

### 11. Importante · Menú y encabezado cortados en el celular (ya reportado)
- **Qué pasó:** además, en `/settings/skills` aparece una barra de scroll horizontal.

### 12. Importante · Jerga interna (ya reportado; ejemplos nuevos)
- **Ejemplos:**
  - `creative_production`, `no_menciona` y "flags: location_risk";
  - el modelo y la versión del prompt;
  - "Horas para cerrar", y "Demanda 25.0" sin unidad;
  - la categoría "framework" para Accesibilidad y "dominio" para Figma;
  - "~0 h para cerrar".
- **Arreglo:** tabla de etiquetas en castellano; lo técnico dentro de `<details>`.

### 13. Importante · Las 7 ofertas de la fuente siguen en "Evaluando…" 5 minutos después
- **Pantalla:** `/jobs` (`24`).
- **Qué pasó:** no dice cuánto falta ni si falló, y aparecen antes que las suyas. (En local no corre el worker de evaluación: ver el resumen.)
- **Arreglo:** "No se pudo evaluar" con "Reintentar" a los N minutos; las que evalúan, al final.

### 14. Pulido · Pantalla en blanco después del login (ya reportado)

### 15. Pulido · El asistente de email asume Gmail de escritorio
- **Qué pasó:**
  - el menú que nombra no existe en la app del celular;
  - la dirección se parte con una letra huérfana a 390 px;
  - "Lo hago después" es el botón principal.
- **Arreglo:** `break-all` en la dirección; "Lo hago después" como secundario; "desde una computadora".

### 16. Pulido · Orden del detalle
- **Qué pasó:** "Tu score" y el formulario de postulación están antes que la descripción. "acción: Descartar" es una etiqueta gris sin color.
- **Arreglo:** la descripción plegada arriba; el formulario plegado por defecto.

### 17. Pulido · Consistencia
- **Qué pasó:** "Pendiente" aparece como título y como chip. "Cerrar" significa cosas distintas en una oferta y en el plan.

## Lo que funcionó bien
1. Registro y onboarding claros, con ejemplo inventado y aviso de privacidad sobre el texto que va al modelo.
2. El catálogo de skills de UX/UI es completo y la búsqueda funciona.
3. Guardar skills actualiza `/market` y `/plan` en menos de 30 s.
4. La separación entre bloqueadores (frenan) y riesgos (no frenan) se lee bien.
5. "¿Cómo se calcula?" y "Candidatos a skill nueva" explican de dónde sale cada dato.

## Top 3 por impacto y esfuerzo (según la persona)
1. Disciplina por rol (resuelve 1, 2 y parte del 3).
2. Acciones en ofertas descartadas o con bloqueadores.
3. "Perfil" en Ajustes.
