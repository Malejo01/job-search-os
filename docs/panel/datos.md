# Panel · `datos`: Data Analyst en transición desde contabilidad

Persona sintética (ficha en `fichas.md`). Recorrido en la app local con datos ficticios y el LLM en modo demo. Lente: transición de carrera, con Excel fuerte y SQL básico. Las capturas no se versionan; los números entre paréntesis las nombran.

## Resumen
- Hizo todo solo en unos 8 minutos y cargó 4 JDs.
- Lo nuevo de datos anda a medias. Excel y Power BI aparecen y llegan a `/market` después de guardar las skills, pero:
  - no se encuentran buscando en español;
  - Estadística y Tableau no aparecen en `/market` ni en `/plan`;
  - el plan no dice qué estudiar para datos.
- Lo que más lo sacó: las 3 ofertas de datos que le calzaban salen "Descartar", con bloqueadores contradictorios.

## Hallazgos

### 1. Bloqueante · La experiencia contable figura como bloqueador cuando el aviso la pide
- **Pantalla:** detalle de "Analista de Reportes (Excel y Power BI)" (`11`).
- **Qué pasó:** "años en otro dominio (contabilidad o control de gestión)" como bloqueador, con "Contabilidad" en el match fuerte de la misma pantalla.
- **Arreglo:** que "años en otro dominio" no se dispare si el dominio pedido es el de la persona. Revisar el prompt o la regla de `decide()`.

### 2. Bloqueante · El mismo ítem es bloqueador y match fuerte
- **Pantalla:** detalle de la JD de estadística y BI (`13`).
- **Qué pasó:**
  - el bloqueador "años en otro dominio (Experiencia previa en un área de negocio)" convive con "Match fuerte: Experiencia previa en área de negocio" y con la señal "el candidato es contador";
  - es la oferta que mejor le calza y sale "Descartar", con el score bajando de 6 a 4.
- **Arreglo:** validar que un mismo texto no esté a la vez en bloqueadores y en matches.

### 3. Importante · "Marcar aplicada" es el botón principal en ofertas con bloqueadores
- **Arreglo:** con bloqueadores, "Descartar" como principal y "Marcar aplicada" como secundario o con confirmación.

### 4. Importante · "Años en otro dominio (data)" en una oferta de datos
- **Pantalla:** detalle de "Data Analyst (SQL and Python)" (`12`).
- **Qué pasó:** la oferta pide 2 años de analista y tiene 0, pero el texto dice "otro dominio (data)".
- **Arreglo:** "Pide 2 años como analista de datos; tenés 0", y que sea riesgo y no bloqueador cuando son pocos años y el perfil recién arranca.

### 5. Importante · La búsqueda de skills en español no encuentra lo esperado
- **Pantalla:** `/onboarding/skills?rol=data_analyst` (`06`).
- **Qué pasó:**
  - "tablas dinámicas", "planilla", "tableros", "dashboard" y "power" no encuentran nada;
  - **"excel" trae "Inglés avanzado/fluido (C1+)"**, por el alias "excellent english" de la skill de inglés: el buscador de la pantalla busca por subcadena;
  - "estadistica" no devuelve nada porque la skill ya está en pantalla, sin aviso.
- **Arreglo:**
  - aliases en español (tabla dinámica, planilla, tablero, BI, visualización de datos);
  - buscar por palabra o prefijo, no por subcadena;
  - "Ya la tenés arriba" cuando la skill ya está cargada.

### 6. Importante · Estadística, Tableau y Power Query no aparecen en `/market` ni en `/plan`
- **Pantalla:** `/market` y `/plan` (`14`, `15`, `20`).
- **Qué pasó:** la JD de estadística las pide, pero el top de gaps se llena con Client-facing, Snowflake, Azure y AWS, y no figuran en la tabla completa.
- **Arreglo:** filtro por rol; confirmar que las skills nuevas entran en la extracción.

### 7. Importante · `/market` no incluye las ofertas cargadas hasta que se guardan skills
- **Pantalla:** `/market` antes (`14`) y después (`20`) de guardar.
- **Qué pasó:** antes de guardar, Power BI no existía y Excel tenía 1 mención con 3 JDs que lo piden. Después pasó de 28 a 32 skills. La explicación está escondida en "¿Cómo se calcula?".
- **Arreglo:** "Incluye ofertas hasta el <fecha>" bajo el título, o recalcular al cargar una oferta.

### 8. Importante · `/plan` no sirve para planear la transición
- **Pantalla:** `/plan` (`15`).
- **Qué pasó:**
  - "27 skills · ~512 h";
  - arriba, SQL, ETL, Python y Snowflake "sin recurso aprobado" y "~0 h para cerrar" (falso: falta el dato);
  - después vienen Node.js, NestJS, Vue, Go, .NET y Medios de pago;
  - no hay recursos de datos (los únicos con link son de observabilidad, CI/CD, AWS y agentes);
  - "Prioridad 16.7" sin unidad.
- **Arreglo:**
  - "sin estimar" en vez de "0 h";
  - "Empezá por acá" en las 3 primeras;
  - recursos de datos en el catálogo (SQL, Power BI, estadística, Python para datos);
  - plegar lo ajeno al rol.

### 9. Importante · Mis skills pierde el rol al guardar
- **Pantalla:** `/settings/skills` (`18`, `19`).
- **Arreglo:** recordar el rol y mantener `?rol=` después de guardar.

### 10. Importante · El inglés como skill repite el nivel CEFR del perfil
- **Pantalla:** `/onboarding/skills?rol=data_analyst` (`05`).
- **Qué pasó:** la escala "nunca lo usé… lo uso con soltura" no tiene sentido para un idioma ya declarado en el perfil.
- **Arreglo:** sacar el inglés de las sugeridas y usar solo el CEFR.

### 11. Importante · Nombres de skills opacos para alguien que viene de contabilidad
- **Qué pasó:** "Product analytics", "Client-facing / explicar a no técnicos", "Snowflake / Databricks" y "Pipelines de datos / ETL".
- **Arreglo:** una línea de ayuda por skill ("Ej.: medir el uso de un producto con métricas").

### 12. Importante · Ninguna oferta de la fuente es de analista
- **Pantalla:** `/jobs` (`08`).
- **Qué pasó:** las 7 son de desarrollo o ingeniería de datos, en "Evaluando…", y llenan `/market` de términos de ingeniería.
- **Arreglo:** filtrar por rol, o decir "no hay ofertas de tu rol en esta fuente hoy".

### 13. Importante · El asistente solo nombra portales de desarrollo
- **Pantalla:** `/onboarding/asistente` (`07`).
- **Qué pasó:** nombra LinkedIn, Get on Board e Indeed. Un analista en su país usaría otros portales generalistas.
- **Arreglo:** "u otros portales: si llega por email, igual se carga". (Ojo: hoy solo hay parser para tres remitentes y el resto va a la cola manual; el texto no debe prometer de más.)

### 14. Pulido · Claves internas en el detalle
- **Qué pasó:** `no_menciona`, `desconocido`, `discipline_cap -5`, el modelo, "flags: location_risk", "hibrido" sin tilde.

### 15. Pulido · Mayúsculas inconsistentes en los bloqueadores

### 16. Pulido · Error de resumen corto sin contador

### 17. Pulido · Columnas de `/market` en escritorio sin explicar
- **Qué pasó:** "Must", "Demanda" y "Horas". En el celular se leen mejor ("Requisito 4 de 4 avisos").
- **Arreglo:** usar esas etiquetas en escritorio.

### 18. Pulido · "Candidatos a skill nueva" con ruido
- **Qué pasó:** "PTO", "hrs", "API".

### 19. Pulido · Títulos cortados en `/jobs` en el celular

### 20. Pulido · Criterios de fábrica
- **Qué pasó:** "Datos" y "Negocio" sin marcar, un salario de referencia que no puso y "Riesgo de inglés desde: Avanzado" siendo B1.
- **Arreglo:** marcar que son valores por defecto.

**Otro detalle:** en "Data Analyst (SQL and Python)", el match fuerte incluye "Excel y tablas dinámicas", que la oferta no menciona. Puede ser un artefacto del LLM en modo demo.

## Lo que funcionó bien
1. Registro, términos y login sin fricción.
2. Skills por rol con niveles en lenguaje humano; Excel y Power BI aparecen para Data Analyst.
3. El aviso de guardado fue cierto: Power BI y su nivel de SQL llegaron a `/market`.
4. `/market` en el celular es mucho más legible que la tabla de escritorio.
5. Separar bloqueadores, riesgos, match y gaps ayuda, cuando no se contradicen.
