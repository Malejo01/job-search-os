# Panel · `aieng`: AI engineer mid con 4 años, inglés C1 (persona de control)

Persona sintética (ficha en `fichas.md`). Recorrido en la app local con datos ficticios y el LLM en modo demo. Lente: el perfil para el que la app está mejor calibrada, más funciones de usuario avanzado (criterios, estados, postulaciones, formulario). Las capturas no se versionan; los números entre paréntesis las nombran.

## Resumen
- Hizo todo sola en unos 10 minutos: registro, perfil, skills, 5 JDs, estados, criterios y formulario. Nada la frenó.
- **Lo que anda:** la evaluación de cada oferta es útil y casi siempre correcta (tres JDs con 8, una con 2 y sus bloqueadores).
- **Lo que falla es todo lo que agrega:**
  - `/market` y `/plan` no le dicen nada de IA;
  - los criterios editados no se reflejaron en una oferta nueva (a verificar).

## Hallazgos nuevos

### 1. Bloqueante (a verificar) · Los criterios editados no se reflejan en la oferta nueva
- **Pantalla:** `/settings/criteria` y el detalle de una oferta de ML nueva (`15`, `17`).
- **Qué pasó:** guardó la versión 2 con "Ingeniería de ML" marcada y 12 años máximos. Una oferta de ML con 10 años salió con los bloqueadores "Años requeridos ≥ 8" y "años de otra disciplina (ml_engineer)", como si siguiera la versión 1.
- **Nota del lead:**
  - `max_years_hard` no se usa en `decide()`: el bloqueador de años lo arma el modelo a partir del prompt;
  - en local el LLM está en modo demo, que puede ignorar los criterios;
  - verificar con el modelo real que el prompt reciba la versión vigente.
- **Arreglo:** mostrar en el detalle "evaluada con criterios vN".

### 2. Importante · Un error de umbrales en los criterios borra todo lo editado
- **Pantalla:** `/settings/criteria?error=thresholds` (`14`).
- **Qué pasó:** el mensaje es claro, pero se pierden la disciplina marcada y el cambio de años.
- **Arreglo:** devolver los valores enviados al re-renderizar con error.

### 3. Importante · Una oferta duplicada se fusiona sin avisar
- **Pantalla:** detalle con `?nueva=merged` (`16`).
- **Qué pasó:** otra oferta con la misma descripción la llevó a la anterior (otro título, descartada), sin banner. El único rastro es una segunda línea "Manual" en Fuentes.
- **Arreglo:** banner "Ya tenías esta oferta (…). Se sumó esta fuente." con `role=status`.

### 4. Importante · "Analizar" descarta preguntas sin avisar
- **Pantalla:** formulario de postulación (`10`).
- **Qué pasó:** de 4 preguntas numeradas detectó 3. Quedó afuera la que no termina en "?", sin aviso.
- **Arreglo:** "Detecté 3 de 4 líneas", con las no reconocidas editables, o tratar toda línea numerada como pregunta.

### 5. Importante · El formulario muestra códigos internos y un comando de consola
- **Pantalla:** formulario de postulación (`10`).
- **Qué pasó:** "el modelo no respondió (no_route)", "sueldo sin calcular (…_inconsistente): el [salario de referencia] del perfil y el de los criterios no coinciden" (ella nunca cargó uno) y "sin cargar: completá applicant:sync".
- **Arreglo:** traducir los motivos ("No pudimos redactar este borrador, escribila vos"; "Cargá tu salario de referencia en Ajustes"); el comando, solo para admin.

### 6. Importante · `/market` y `/plan` no son para un AI engineer
- **Pantalla:** `/market` y `/plan` (`18`, `19`).
- **Qué pasó:**
  - los gaps son SQL, Client-facing, ETL, Snowflake, AWS y Azure;
  - en el plan aparecen n8n, "Medios de pago", Go, .NET, Java y Vue;
  - sus gaps reales de IA (MCP, Guardrails, LangChain, Prompt engineering) no aparecen.
- **Arreglo:** filtrar por las disciplinas marcadas y por el rol; tope de 5 a 8 con "ver el resto".

### 7. Importante · La penalización por inglés avanzado ignora el nivel de la persona (verificado en el código)
- **Pantalla:** detalle de la JD 1 (`07`): "Score del modelo 9 → 8 (english_fluent_penalty -1)", con inglés C1 y un aviso que pide avanzado. Pasó también en otras dos JDs.
- **Causa:** `packages/pipeline/src/decide.ts:246-256` resta si el inglés requerido es avanzado o nativo sin mirar el CEFR (el riesgo de inglés de la línea 262 sí lo mira). Los criterios de fábrica de los invitados traen `english_fluent_penalty: 1`.
- **Arreglo:** penalizar solo si el nivel de la persona está por debajo del exigido.

### 8. Importante · La evaluación y el pre-score se contradicen sobre sus skills
- **Pantalla:** JD 4 y JD 1 (`07`, `09`).
- **Qué pasó:** el pre-score dice "Te faltan: MCP, Guardrails" (nivel curso) y el modelo pone Guardrails y Prompt engineering (sin nivel cargado) en el match fuerte.
- **Arreglo:** pasarle al evaluador los niveles de skills; una categoría intermedia "tenés a nivel curso".

### 9. Importante · Una oferta descartada por título (lista de bloqueados) no se puede evaluar
- **Pantalla:** "Principal ML Engineer" (`16`).
- **Qué pasó:** solo ofrece "Cerrar".
- **Arreglo:** "Evaluar de todos modos".

### 10. Importante · `/applications` confunde
- **Pantalla:** `/applications` (`12`, `20`).
- **Qué pasó:**
  - arriba hay una tabla de calibración de 8 columnas con "100 % (1 de 1; métrica del PRD, sin baseline todavía)": jerga, y un porcentaje engañoso;
  - rangos "7–8,9" y "1 postulaciones";
  - "Entrevista" aparece tres veces en la misma fila.
- **Arreglo:** primero la lista, la calibración plegada con 5 o más postulaciones, rangos legibles y plural correcto.

### 11. Importante · Criterios de fábrica con valores de otro perfil
- **Pantalla:** `/settings/criteria` (`13`).
- **Qué pasó:**
  - salario de referencia de 3000 y 40 h que no cargó;
  - "agent architect" como título permitido;
  - palabras como saviynt, sailpoint, iso 8583 y prince2;
  - 8 años máximos.
  El salario de fábrica produce el mensaje del hallazgo 5.
- **Arreglo:** valores neutros o tomados del onboarding.

### 12. Pulido · El chip de ubicación es inconsistente
- **Qué pasó:** "Ubicación: no" junto a un riesgo que dice lo mismo. "Riesgo" igual para "solo EE. UU." que para "LATAM sin países".

### 13. Pulido · Bloqueadores repetidos
- **Pantalla:** JD 3 (`08`).
- **Qué pasó:** 6 bloqueadores, 3 del mismo hecho (10+ años). "Disciplina distinta (ml_engineer)" para un Staff AI Engineer.
- **Arreglo:** agrupar por causa.

### 14. Pulido · Códigos en pantalla
- **Qué pasó:** `location_risk`, `sin_respuesta`, `ai_core` y "Disciplina: ai_engineer". La hora de los criterios aparece en UTC.
- **Arreglo:** hora local.

### 15. Pulido · Las listas largas de los criterios se cortan sin pista; las disciplinas se mezclan en dos columnas

### 16. Pulido · Validación del resumen corto sin mensaje propio

### 17. Pulido · "Cerrar" es ambiguo en la oferta y en el plan
- **Arreglo:** "Cerrar oferta (ya no se postula)" y "Descartar skill".

## Lo que funcionó bien
1. Registro y onboarding sin fricción.
2. Anterior/siguiente en el detalle, con el extremo deshabilitado.
3. La evaluación de tres de sus JDs es coherente con el perfil; el veredicto se lee rápido, también en el celular.
4. Cambiar el estado se refleja al instante en `/applications`, con la corrección explicada.
5. El formulario de postulación deja claro que "Nada se envía desde acá", y el flujo Analizar → Borradores → Aprobar se entiende.

## Top 3 por impacto y esfuerzo (según la persona)
1. Penalización de inglés con el CEFR (una condición en `decide.ts`).
2. Traducir códigos internos y comandos.
3. Conservar los valores tras un error en los criterios y el banner de fusión. El 1, verificarlo cuanto antes.
