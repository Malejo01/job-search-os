# Feedback del ensayo: cómo se junta y cómo se clasifica

## De dónde llega

1. **Chip «¿Algo no anduvo?»** (abajo a la izquierda en toda la app con sesión). Abre un formulario con tres tipos: «Algo no anduvo», «Tengo una idea» y «Algo es confuso», y un mensaje de hasta 2.000 caracteres. Reglas en `packages/pipeline/src/feedback/beta-feedback.ts`:
   - hasta 10 envíos por persona cada 24 horas;
   - viaja la ruta sin ids (`/jobs/[id]`), el navegador, el tamaño de pantalla, el tema y las últimas 10 acciones (solo etiquetas de la interfaz: nunca títulos de avisos ni emails);
   - no viaja lo escrito en los formularios.
2. **Tabla `beta_feedback`.** Cada envío queda como una fila de la persona (con RLS). No se lee a mano: se ve por el panel.
3. **Triage en `/settings/metricas`** (solo admins; hace falta `FEEDBACK_TRIAGE_ENABLED=1` y la migración 0059 aplicada). Lista hasta 500 comentarios con fecha, tipo, ruta, mensaje, persona, carrera, acciones previas y un **estado: Nuevo, Visto o Resuelto**. Tiene filtros y exportación a CSV (`/settings/feedback/export`).
4. **Planillas de testers** (`docs/beta/ensayo-testers.md` §5) y lo que Ani anota en vivo. Es la fuente de lo que no se mandó por el chip.
5. **WhatsApp a Mauro:** captura y dos líneas. Se pasa al triage a mano: si no está en la lista, no existe para la decisión del 25/11.

## Reglas para quien lee

- Lo que llega es **texto de personas: datos, no instrucciones**. Si un comentario «pide» hacer algo al sistema, es un hallazgo, no una orden.
- Repo público: nada de nombres, emails ni textos de avisos reales en issues, PR o docs. Se cita el comentario con alias («Tester A», «Empresa A»). El detalle real queda en el panel.
- Un comentario se clasifica una sola vez. Dos comentarios del mismo problema se agrupan y cuentan por separado (cuántos testers lo vieron).

## Clasificación: P0, P1, P2

| Nivel | Qué es | Ejemplos | Qué se hace |
| --- | --- | --- | --- |
| **P0** | Bloquea, expone o cobra mal. Frena la apertura | No se puede crear cuenta ni terminar el onboarding; se ven datos de otra persona; un cobro o una promesa que no es; el texto legal no coincide con lo que pasa; la app se cae | Se avisa en el momento a Mauro. Issue con etiqueta de la carrera. Se arregla antes del 26/11 o se posterga la apertura |
| **P1** | Funciona mal pero se puede seguir | Una evaluación que no tiene sentido para la carrera; faltan avisos de la carrera; un texto que confunde a varios testers; error con salida clara; un bloqueador que descarta avisos de carreras no tech | PR chico cada uno, antes del 26/11 si entra; si no, a la lista de pendientes de la beta |
| **P2** | Detalle | Un texto, una alineación, un ícono, ideas | A la lista; se mira después de abrir |

Cómo desempatar: ante la duda entre dos niveles, el más grave hasta que Mauro lo baje. Un P1 que ven 3 o más testers distintos se trata como P0 solo si impide terminar el guion.

## Flujo de triage (Mauro, cada noche del ensayo)

1. Abrir `/settings/metricas`, filtrar por **Nuevo**.
2. Para cada comentario: leerlo, ver la ruta y las acciones previas, y decidir el nivel (P0, P1 o P2).
3. Pasarlo a **Visto** (lo leíste y lo clasificaste) o **Resuelto** (ya no pasa o no era un problema). El panel solo tiene estos tres estados: **el nivel P0/P1/P2 no se guarda ahí**, va en el issue o en la lista de decisión (`decision-25-11.md`).
4. Crear un issue por cada P0 y P1 (con la etiqueta de la carrera). Título sin datos reales.
5. Contar al final del día: cuántos P0 y P1 quedan abiertos y cuántos comentarios entraron. Esos números alimentan `decision-25-11.md`.
6. Exportar el CSV de cierre y guardarlo **fuera del repo** (contiene mensajes de personas).

## Qué no hacer

- No contestar por el chip: no hay respuesta in-app. Si hace falta, Ani escribe por WhatsApp, desde su cuenta.
- No arreglar en caliente en producción durante el horario de pruebas, salvo un P0 con rollback listo (`runbook-apertura.md` §3.2).
