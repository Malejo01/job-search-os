# ADR-026: CV redactado por IA con verificador que no deja inventar

**Status:** Proposed · **Date:** 2026-10-26

## Context
Mauro pidió que la app ayude a armar el CV con una charla guiada: la IA hace preguntas, y al
cerrar entrega un CV completo que cumpla el formato que leen los sistemas de selección (ATS). El
diseño de la ronda 100 armaba el CV solo con datos confirmados y sin modelo. Pedirle a un modelo que
redacte abre un riesgo que ese diseño no tenía: un CV con una empresa, una cifra o una tecnología
que la persona nunca dijo, que ella firma y manda a un reclutador. A eso se suman tres límites del
proyecto: el modelo evalúa y el código decide, no se guardan conversaciones (ADR-008, D6 de la 100)
y el gasto en LLM tiene que quedar acotado (`docs/LLM_COSTOS.md`).

## Decision
1. **La IA pregunta y redacta, pero no inventa.** Hace dos trabajos: extraer lo que la persona
   dice a un esquema estricto (`cv_interview`) y pasar sus respuestas a viñetas y resumen en estilo
   ATS, es o en (`cv_write`). Los prompts prohíben agregar empresas, cargos, fechas, cifras, skills
   o links, pero el prompt no es la garantía: lo es el código.
2. **Verificador puro** (`packages/pipeline/src/cv-out/verify.ts`). Cada viñeta y el resumen
   generados se comparan con las respuestas de origen de esa entrada (empresa, cargo y lo que la
   persona dijo). Se descarta el texto si trae un número (en cifras o en letras, es/en), un nombre
   propio (también al arranque de la oración), una tecnología o un link, email o dominio suelto que
   no estaban en las respuestas. Al descartarse queda el texto de la persona, apenas limpiado. El
   resumen que no pasa se omite, porque no hay texto propio contra el cual caer. Es conservador a
   propósito: un falso positivo cuesta una viñeta sin pulir; un falso negativo, un dato inventado en
   el CV. El mismo patrón verifica el acuse corto del turno (sin dígitos ni links) y contrasta la
   extracción con el mensaje de la persona. La carga manual usa el mismo filtro de links.
3. **Temario determinista.** Qué se pregunta lo decide un checklist del código: puesto objetivo,
   experiencia de a un trabajo (empresa, cargo, fechas, qué hacía, un logro), estudios,
   certificaciones, skills, idiomas y links. La pregunta siguiente es una plantilla fija; el modelo
   no la elige ni la redacta. Cierra cuando el checklist se completa, con «Terminar y armar» o a los 25
   turnos. Un tema que falla dos veces se saltea. Un CV pegado en el chat se deriva a la lectura de
   CV (ADR-008) sin llamar al modelo, y el texto de la persona entra al prompt como dato, no como
   instrucción.
4. **La conversación no se guarda.** El estado viaja en cada request, se valida con un esquema
   estricto, y el id de la charla y los turnos van en un ticket firmado (HMAC con una subclave de
   `AUTH_SECRET`, atado al usuario, vence a las 2 h). En la base queda solo `llm_calls` (tarea,
   modelo, tokens, costo, `label = cv:<id>`, sin textos) y, **solo si la persona confirma**, el
   historial en `career_history` con `source = 'chat'`, con la misma validación que la carga manual.
   Antes de descargar, cada sección se revisa y se edita en la vista previa; nada se guarda sin su
   clic. El resumen, las skills, los idiomas y los links de la charla se ven en la vista previa pero
   todavía no se guardan (queda abierto para Mauro: guardarlos toca `profiles.profile_summary`, que
   alimenta al evaluador).
5. **Topes, todos fallan cerrado** y devuelven un mensaje fijo con links a las pantallas manuales
   (nunca texto del modelo):
   - por turno: respuesta de hasta 2.000 caracteres, un modelo con deadline de 50 s;
   - por conversación: 25 turnos y USD 0,15;
   - por persona y día: USD 0,30 de entrevistas y 5 charlas nuevas;
   - global: `CV_CHAT_DAILY_CAP_USD` (USD 1,00 por día si no se define; un valor mal escrito cierra);
   - por mes (actualizado en C2-1, beta abierta con `CV_CHAT_ENABLED=all`): el cupo «CV por mes» es el del plan (`cvReadsPerMonth`: gratis 1, pago 5) con un piso de 3 (`CV_CHAT_BETA_LIMITS.cvPerMonth` en `plans.ts`), más 40 turnos de entrevista por persona (`interviewTurnsPerMonth`, motivo `turnos_mes`). Los intentos fallidos que llegaron al proveedor cuentan como turno y suman el máximo del paso al gasto (el proveedor los factura); solo `provider_unavailable` no cuenta. Los números son una primera decisión sin medición de uso real. Antes, el cupo se contaba por
     charlas con una redacción exitosa, y una sola redacción por charla.
6. **Reservas para la concurrencia.** Los topes leen `llm_calls` antes de llamar y el registro real
   se escribe después, así que dos pedidos en paralelo pasaban los dos. Antes de cada llamada, una
   transacción corta con `pg_advisory_xact_lock` por persona mide los topes sumando las reservas
   vigentes e inserta una reserva; la reserva es el **máximo** del paso, no el promedio: USD 0,025
   por turno y USD 0,07 por redacción (máximos calculados de 0,0241 y 0,0693: el prompt más largo
   que acepta la ruta, el primario agotando `max_tokens` y el respaldo agotando el suyo; un test de
   adapters los recalcula con el seed). La
   llamada al modelo va afuera de la transacción y la reserva se borra al terminar. Una reserva
   huérfana deja de contar a los 2 minutos. No se usan locks de sesión: no son seguros detrás del
   pooler de Neon en modo transacción. Las filas `cv_reserve` y `cv_start` no suman USD en ningún
   reporte. Queda aceptado que el tope global no tiene lock propio y el exceso es de pocos estimados.
7. **Gate `CV_CHAT_ENABLED`:** `admin` (solo las cuentas de `ADMIN_EMAILS`) o `all`; cualquier otro
   valor, apagado (una sola función, `cvChatMode` en el pipeline, la usan la página y la ruta).
   Arranca en `admin` hasta que Mauro lo pruebe. Antes de pasar a `all`, conviene contrastar las
   reservas (calculadas como máximo del paso) con el costo real de la medición con llamadas reales.
8. **Modelos por `model_routing`**, tareas `cv_interview` y `cv_write`, con respaldo en otro
   proveedor. **Primario `gemini-3.5-flash` (thinking `minimal`) en las dos**; respaldo Haiku 4.5 en
   la entrevista y Sonnet 5.5 en la redacción. El motivo: los modelos de Anthropic fallan con
   `no_object` del 10 al 40 % de las veces (C-24, hipótesis: el SDK saca los límites del esquema que
   ve el modelo y zod los valida igual) y Gemini no falla. Nada hardcodeado fuera del seed.
9. **El CV se genera sin dependencias nuevas:** DOCX propio y PDF por impresión del navegador
   (ronda 100, §3.2). El DOCX sale de `career_history` y los datos del perfil, no del chat.

## Alternatives
- **CV sin modelo** (la 100): cero riesgo de invención y cero costo, pero no cumple lo que se pidió
  (una charla que arma el CV) y deja viñetas sin pulir.
- **Redactar y confiar en el prompt:** una instrucción de no inventar no es una garantía; viola «el
  modelo evalúa, el código decide».
- **Que el modelo decida qué preguntar:** conversación más natural, pero el temario deja de ser
  auditable, el costo por turno sube y se abre la puerta a desvíos o a inyección. Se descartó.
- **Guardar la conversación** para retomarla: contradice ADR-008 y D6, y ensancha lo que hay que
  proteger y borrar.
- **Pregunta redactada por el modelo en una segunda llamada:** con 25 turnos y USD 0,15 por charla
  no entran dos llamadas por turno. Queda como opción si Mauro la prefiere.
- **Locks de sesión de Postgres** para la concurrencia: se descartaron por el pooler de Neon.
- **Librería para DOCX/PDF** (`docx`, `pdf-lib`): sumaría dependencias; el formato ATS es simple y
  el camino de lectura ya existe en el repo para hacer pruebas de ida y vuelta.

## Consequences
- **Lo que se publica es lo que dijo la persona**, ordenado y con verbos de acción; el modelo no
  suma hechos. A cambio, parte de las viñetas va a salir sin reescribir (falsos positivos del
  verificador, por ejemplo un verbo inicial que no comparte raíz con la respuesta). La proporción
  de descartes es una métrica de CVC-6 y puede afinar el verificador.
- **El costo por CV es un estimado sin red** (CVC-6): USD 0,019 a 0,028 con Gemini Flash y 0,013 a
  0,019 con el respaldo, con 12 a 18 turnos; falta medirlo con llamadas reales. Ver la sección de
  `docs/LLM_COSTOS.md`. Los topes de arriba acotan el peor caso.
- **Cada charla es una unidad de gasto con tres líneas de defensa:** topes, reservas y gate. Subir
  `CV_CHAT_ENABLED` a `all` es una decisión de Mauro, después de CVC-6 y de calibrar las reservas.
- **Los datos que las respuestas envían a Google o Anthropic** (lo que escribe la persona sobre su
  trabajo y estudios) tienen que figurar en la política de privacidad antes de abrir el gate a
  `all`: propuesta en `ops/rondas/C25-cv-conversacional/propuesta-legales.md`.
- **Una charla interrumpida se pierde** (no se guarda): es el precio de no persistir la conversación;
  lo confirmado antes de cortar sí queda.
- Mantenimiento: el verificador tiene listas cortas (extensiones de dominio, números en letras,
  verbos irregulares) que habrá que ampliar con los casos que aparezcan.
- El numeral de este ADR se revisa al integrar, por si otro PR abierto ya usó el 026.
