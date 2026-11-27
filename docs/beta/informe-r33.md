# Informe de la R33 «CV»

Tanda sobre el CV: pantalla «Tu CV», borrador, los dos asistentes, revisión, diagnóstico, contacto y links, PDF real y calidad del contenido. Pasos para el responsable del proyecto: `docs/beta/pasos-manuales-r33.md`. Estado de cada punto del informe de revisión: `docs/beta/verificacion-informe-ani.md`. Informes de cada ticket: `ops/rondas/r33-tanda/r33-NN/informe.md` (privado).

Las partes que dependen de otros teammates o de correr los e2e están marcadas **(completa el lead)**.

## Qué entró por ticket

| Ticket | Qué entró |
|---|---|
| R33-01 · Tu CV | `cvScreen` (pipeline, puro): tres estados (vacío, parcial, completo) y la lista de faltantes en orden. La pantalla muestra solo la puerta («Tengo CV» / «No tengo CV») si no hay nada, y cada faltante trae su botón al campo exacto. Aviso de borrador con «Retomarlo». e2e 428 |
| R33-02 · Borrador | Tabla `cv_drafts` (migración 0091, RLS 0075, con `FORCE` y cascada con la cuenta), guardado automático en el chat y las propuestas pendientes del coach, vencimiento a 30 días (`purgeStaleCvDrafts`, probada en integración, **sin programar**). Nada entra a `career_history` sin confirmar. Route handler `/api/cv-coach/borrador`. e2e 410 |
| R33-03 · Asistentes: conversación | En el chat de `/cv/armar` y en el coach: un solo botón principal «Responder y seguir»; «Saltear esta pregunta» como enlace y lo salteado a la vista para volver; «Terminar y armar» aparte, con datos suficientes y confirmación con lo que falta; tras dictar, revisar antes de seguir (el dictado nunca envía); avance como lista de 7 temas con texto además del ícono; variante sin experiencia. Lógica pura en `packages/pipeline/src/cv-chat/guided.ts`. Arreglo de paso: el link «Otro» de R33-07 rompía el estado estricto del chat (todo turno daba `bad_request`); el chat ahora toma solo los links que conoce (`pickCvChatLinks`). e2e 411 y 413 |
| R33-04 · Asistentes: resumen y habilidades blandas | Resumen profesional armado **por el código** con las palabras de la persona (tres preguntas de a una, un bloque editable, sin «Objetivo»; vacío si lo vacía). Habilidades blandas por situaciones, con una tabla fija (nunca la pregunta directa), cada una con de dónde salió, la viñeta que sumaría, «Usarla» / «No, gracias» y máximo 4. Si el trabajo ya tiene 4 tareas, la viñeta no entra y se dice («Ya tenés 4 tareas en este trabajo…»); la habilidad entra igual. Validador `cvSummaryCheck` (tests primero) que rechaza cifras, nombres, tecnologías o links que la persona no dijo. Sin llamadas al modelo. e2e 412 |
| R33-05 · «Esto es lo que entendí» | Revisión del chat extraída a `review-editor.tsx`: ejemplos que no parecen datos, «Sin completar», quitar trabajo con confirmación y «Deshacer», agregar trabajo y estudio, habilidades como chips, idiomas con el nivel explicado, links, «Guardar y ver mi CV». Mismo trabajo en las tarjetas del coach. e2e 430 |
| R33-06 · Diagnóstico | Palabra y número entero con cortes probados, frase fija, ⓘ en cada barra, «Legibilidad» y «Largo» separados, cada «falta» con su botón y una sola acción principal. e2e 429 |
| R33-07 · Contacto y links | La vista previa se actualiza sola; ciudad y país marcados («Incluye ciudad y país, no tu dirección»); editor de links solo `https` con «Abrir para probarlo» (server action nueva, sin migración); aviso «¿Completarlo antes?» antes de descargar; «Habilidades» en español. e2e 421 |
| R33-08 · PDF real | PDF A4 generado en el servidor desde el mismo modelo que el DOCX, sin dependencia nueva (ADR-049); «Descargar PDF» con estados de carga y error; sesión, ritmo y sin URL pública. e2e 420 |
| R33-09 · Calidad del CV | Avisos suaves (sin titular, habilidades sin respaldo, viñetas de tarea con preguntas guía con las palabras de la persona), «Actualidad», categorías de habilidades comprensibles según el perfil, idioma con su nivel («Inglés: A2, nivel básico»), nunca un dato no confirmado |

| R33-10 · Legibilidad del CV | Reglas de legibilidad de la R30 en modo estricto para las pantallas del CV (`apps/web/test/legibilidad.test.ts`) y auditoría 431 (claro/oscuro, 390/1280 px, zoom 200 %) |
| R33-12 · Arreglos del CI del PR de integración | Ver la sección «R33-12» |

## R33-12 · Arreglos del CI (PR de integración R30–R32)

Reproducidos en local con el entorno del CI (la persona A como admin, la config de Playwright y los datos del seed). Para cada uno, la causa con evidencia; donde el supuesto del test ya no valía se arregló el test, donde era código se arregló el código. Ningún test bajó su exigencia sin una línea que diga por qué.

- **Integración `multiusuario`:** faltaban los CASES de las siete funciones SECURITY DEFINER de la RLS 0074. Sumados (352/352). Al escribirlos apareció el agujero de `news_email_unsubscribe` (ver Decisiones): `REVOKE` y baja con el rol de servicio.
- **349, 359, 63:186 (tarjeta y requisitos):** el perfil del seed del CI trae años e inglés, y la tarjeta (R31) los superpone a la evaluación, así que lo que el test esperaba «Sin confirmar» salía confirmado. Supuesto de datos: helper `apps/web/e2e/perfil-sin-datos-helper.ts` que deja el perfil sin esos datos durante el spec y los restaura.
- **36:98:** la tarjeta de R30-04 trae «Guardar» y «Descartar»; el test pedía cero botones. Lo que el flujo exige (el 👍/👎 no está en la tarjeta) se sigue exigiendo; los únicos botones permitidos son esos dos.
- **138:21:** en el detalle de una oferta no hay barra de pestañas desde R30-10 (el botón «Ir a postularme» va arriba y fijo). El test se adapta y, además, ahora exige en los tres casos que nada fijo tape el botón de feedback (`elementFromPoint`).
- **95:61:** desde R32-03 el mensaje depende de si la carrera está abierta y en el CI ninguna lo está. El spec abre la carrera que prueba en `beforeAll` (y no la cierra si ya estaba); el caso de carrera cerrada lo prueba el 393.
- **02:35 (pegar JD):** el veredicto vive en «Cómo se calculó» (`<details>` cerrado, R30-08); el spec lo abre. En local además apareció un `TypeError` en `decide()` por reglas vacías de un helper viejo (ver No cumplido).
- **89:86 (listado sin JS):** el `Suspense` alrededor de la lista dejaba la página sin las ofertas mientras cargaba. Código: la lista sale sin `Suspense` y el estado de carga queda en el enlace (`useLinkStatus`).
- **21:123 (Gmail primero):** la confirmación de Gmail tiene que ir arriba; el pedido de carrera de R32 la tapaba. Código: `data-prioridad="primero"` en la bandeja y el layout esconde el pedido de carrera cuando hay algo primero.
- **237:62 (recorrido «Abrir»):** el pedido de carrera tapaba el recorrido del primer uso. El spec fija la carrera solo para `/hoy`.
- **16:84:** confirmado en verde en local con la A admin.
- **`.gitleaksignore`:** las cinco líneas de 68e3b22 (secretos de prueba del email de novedades).

## Decisiones

- **PDF sin dependencia nueva.** El guard no deja instalar paquetes. En vez de `pdf-lib`: composición pura (líneas, páginas, viñetas que no se cortan, márgenes A4) y un serializador PDF 1.4 propio con Helvetica y WinAnsi, texto seleccionable y links como anotaciones. Lo que WinAnsi no tiene se reemplaza por lo más parecido y queda informado, nunca roto en silencio. Solo alfabeto latino. `pdf-lib` queda como alternativa en el ADR-049, con el comando.
- **Ritmo de descarga en memoria del proceso.** No hay cuota existente reutilizable sin una tabla (`person-quota.ts` cuenta espacio y filas; el DOCX y las postulaciones no tienen ritmo). En Vercel cada instancia lleva su cuenta, así que casi no frena. Limitación conocida, anotada en el ADR-049. Un ritmo exacto pide una tabla con `user_id` y RLS: decisión aparte.
- **Un solo modelo para vista previa, DOCX y PDF** (`packages/pipeline/src/cv-out/`). Las opciones viajan en la misma consulta: el archivo es igual a la vista previa.
- **El CV no inventa.** Los avisos y las preguntas guía no traen cifras ni respuestas; una habilidad sin respaldo se avisa y no se quita; «Español: nativo» no se asume.
- **Teléfono y cuarto link, sin migración.** Viven en `application_settings.links` (jsonb, con las claves `telefono`, `otro` y `otro_etiqueta`), validados (teléfono: dígitos, espacios, `+ - ( )`, 6 a 15 dígitos; link: `https`; etiqueta: texto plano de hasta 30 caracteres). El teléfono viene **sin marcar** en el CV y en la URL de la descarga solo viaja la marca `tel=1`, nunca el número. El contexto de postulaciones (`packages/adapters/src/applicant/context.ts`, carril rojo) ahora pasa al modelo solo los links de siempre, para que el teléfono no llegue a un prompt. Limitación: el sincronizador de respuestas fijas (`sync.ts`) reescribe `links` entero desde su archivo, así que correrlo borraría el teléfono y el cuarto link de esa cuenta.
- **Links solo `https`.** Un `http` guardado antes deja de salir en el CV.
- **El borrador es del servidor.** En el chat, el estado que se guarda es el que calcula el servidor, no el que manda el navegador.
- **Prompts: ninguno cambió en la tanda.** Los temas nuevos de los asistentes (resumen, blandas, preguntas guiadas) los resuelve el código sin el modelo; `cv_write@v1` sigue igual. Queda el gancho `cvSummaryChoose`: un `cv_write@v2` que redacte el resumen solo entra si pasa el validador. Sin evals que correr.
- **Cierre de `news_email_unsubscribe` (arreglo de seguridad sobre la R32).** Con la R32 sola, la función SECURITY DEFINER de la baja del email de novedades quedaba ejecutable por cualquier sesión autenticada: **cualquier cuenta podía dar de baja a otra**. La RLS 0074 ahora le quita el permiso de ejecutarla a `PUBLIC` y a `authenticated` y la baja corre con el rol de servicio después de verificar el token (`apps/web/lib/news-email.ts`, que pasa al carril rojo). La R32 no se integra sin la R33.

## No cumplido o con reservas

- **C-68 (antes y después):** el componente y la comparación están listos (`CvAntesDespues`, `cvBeforeAfter`), pero ninguna pantalla propone hoy la reescritura de una viñeta existente (el coach solo suma viñetas nuevas), así que no hay «antes» que mostrar. Queda `parcial`.
- **C-62 en los asistentes:** hecho en el chat de `/cv/armar` (pregunta por las fechas y «¿Es tu trabajo actual?» → «Actualidad»). En el coach queda para la R34: necesita un prompt nuevo.
- **C-45, links dichos en el chat:** hecho; los links que la persona da en el chat se guardan en sus links (`saveChatLinks`) y se ven en `/cv`.
- **Defensa de `decide()` ante reglas incompletas:** con `evaluation_criteria.rules = {}` la evaluación revienta con `TypeError` (lo encontró el e2e 02 en la base local, donde un helper viejo dejaba `{}`). En producción no pasa (el alta arma las reglas con `criteriaFromOnboarding`). Que falle cerrado con un mensaje claro es una decisión aparte; se arregló el dato del e2e y se sumó el stack al log de la evaluación inmediata.
- **Sugerencias por rubro (C-21 a C-25) y forma del cargo (C-63):** después de abrir, fuera de la tanda.
- **Tabla 8.2, «La tengo / No la tengo» por habilidad dentro del diagnóstico:** pantalla nueva, para decidir (hoy lleva a `/settings/skills`).
- **Titular editable:** no hay hoy un campo; «Agregar titular» lleva al chat o a `/settings/perfil`.
- **Apertura del PDF y del DOCX en tres programas e impresión en papel (C-55):** pasos manuales.
- **Purga de borradores sin programar** y **migración 0091 y RLS 0075 sin aplicar en Neon.**
- **`multiusuario` (rojo en la R32 sola):** resuelto en la R33 (R33-12): los siete CASES de las funciones SECURITY DEFINER de la RLS 0074, en verde.

## Verificación

Puertas del lead al cierre (27/11, árbol completo, Vitest con `--maxWorkers=4` y turbo con `--concurrency=2`):
- **Typecheck:** 6/6 paquetes en 0. **Lint:** 0 errores (queda 1 aviso viejo en `feedback-button.tsx`, que la tanda no toca); prettier en verde.
- **Unitarios:** pipeline 7351 ✓ (321 archivos); web 670 ✓; db 198 ✓ (la guarda de copia `ui-copy.test.ts` daba un falso positivo con un template literal del chat: se cambió por una concatenación, con el porqué en un comentario); adapters 1811 ✓ y **3 ✗ del entorno**: las pruebas de symlinks de `privacy-scan.test.ts` dan `EPERM` porque Windows no deja crear symlinks sin modo desarrollador. Ajenas a la tanda (el archivo no cambió); en el CI (Linux) corren.
- **Integración de db completa (Docker):** 64 archivos, 817 ✓ (incluye `multiusuario` con los CASES de la 0074 y `cv_drafts`).
- **e2e, de a un spec, con la A como admin como en el CI** (las líneas para simularlo se sacaron antes del commit): 02, 16, 21, 36, 63, 85, 86-cv-chat, 89, 95, 138, 142, 153, 237, 298, 349, 350, 359, 410, 411, 412, 413, 420, 421, 428, 429, 430 y 431 en verde. 431 es la auditoría de legibilidad: 0 hallazgos en 64 combinaciones.
- **Barrido de privacidad:** sin hallazgos en los archivos de la tanda.
- Carril rojo de la tanda (route handlers y server actions nuevos, base): ver `docs/beta/pasos-manuales-r33.md` §1.
