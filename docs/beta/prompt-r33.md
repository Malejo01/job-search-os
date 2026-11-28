Tanda R33 «CV». Armá un **EQUIPO DE AGENTES** con 3 teammates y vos como lead. Mecánica, reglas y cierre: `docs/beta/cadena-r30-r34.md`. Especificación: `docs/beta/plan-r30-r34.md` (secciones 2, 9 y 11).

- Ramas `ronda/r33-NN-<nombre>`. e2e: 410 a 439. Bloque 51 del BACKLOG.
- **Base:** `origin/ronda/r32-integracion` si existe; si no, `origin/ronda/r32-cierre`.
- **Informe de Ani:** la parte 3 (C-01 a C-69). Leé los puntos de cada ticket antes de tocar código.

## Reglas propias de esta tanda

- **Dos caminos, los dos en la beta:** el coach (`/cv/perfil` → `/cv/coach`) para «Tengo CV» y el chat de `/cv/armar` para «No tengo CV». Cada cambio del asistente se aplica **en los dos.** No se retira ninguno.
- **El CV no inventa.** Nunca suma un dato que la persona no declaró. Ninguna sugerencia entra sin que la marque. Lo que está vacío queda vacío.
- **USD 0.** Los prompts que cambian van como versión nueva, sin promover, y se prueban con el modelo simulado.
- **Queda afuera,** para después de abrir: las sugerencias por rubro (C-21 a C-25) y la forma del cargo (C-63). No las empieces.
- **Una sola dependencia nueva permitida:** `pdf-lib`, para el PDF (R33-08). Si el guard no deja instalarla, seguí como dice ese ticket.

## Equipo y tickets

| Teammate | Tickets en orden |
|---|---|
| **asistente** | R33-02 → R33-03 → R33-04 |
| **documento** | R33-08 → R33-07 → R33-09 |
| **calidad** | R33-01 → R33-05 → R33-06 → R33-10 |

`asistente` arranca por la migración del borrador. El lead hace R33-11 al final.

### R33-01 · Pantalla «Tu CV»

IDs: C-01, C-02, C-04.

- **Tres estados:**
  - sin nada cargado: solo «Tengo CV» y «No tengo CV»;
  - con datos parciales: «Seguir armando mi CV» y lo que falta, cada ítem con un botón al campo exacto («Agregar mi experiencia», «Agregar mis estudios», «Escribir mi resumen»);
  - con el CV completo: el diagnóstico y la descarga.
- Si hay un borrador: «Tenés un borrador sin confirmar. [Retomarlo]».
- La regla que decide el estado va en `packages/pipeline`, con tests.

### R33-02 · Borrador automático (carril rojo)

IDs: C-03, C-05.

- Lo que la persona responde se guarda como borrador mientras avanza, en los dos asistentes. Revisá `apps/web/lib/cv-coach/storage.ts` antes de crear una tabla.
- Si hace falta una nueva: `user_id`, RLS con `FORCE` y borrado en cascada con la cuenta.
- **Se borra solo a los 30 días** sin uso. El paso del cron va a los pasos manuales.
- **Texto:** «Guardamos un borrador para que no pierdas nada. Nada entra a tu CV hasta que lo confirmes».
- La mini-tarjeta deja de decir «te falta» sobre algo que está en el borrador: dice que está sin confirmar.
- Integración: nadie lee el borrador de otra persona, y el borrador se va con la cuenta.

### R33-03 · Botones y flujo del asistente

IDs: C-06 a C-14.

Tal cual el informe, en los dos asistentes:

- un solo «Responder y seguir»;
- «Saltear esta pregunta» como enlace, con «Podés volver a esto más tarde»;
- «Terminar y armar» recién con datos suficientes y con confirmación («Vas a armar tu CV con lo que contaste hasta ahora. Falta: […]. ¿Armarlo igual?»), nunca al mismo nivel que «Responder y seguir»;
- el dictado no envía solo;
- el avance como lista de temas, con los 7 (hoy la bienvenida nombra 6);
- «Volver a la pregunta anterior»;
- la privacidad, una sola vez, en un ⓘ;
- el mensaje de honestidad, corto y arriba;
- un camino para quien no tiene experiencia: proyectos, estudios, voluntariado y cursos.

### R33-04 · Resumen profesional y habilidades blandas

IDs: C-15 a C-20.

- **Tema «Resumen profesional»:** 4 preguntas y un borrador editable de 2 o 3 frases, sin cifras inventadas y en un solo bloque, sin «Objetivo» aparte.
- **Habilidades blandas por situaciones:** preguntas sobre situaciones concretas. Cada habilidad propuesta dice de dónde salió y lleva «Usarla» o «No, gracias». Entre 2 y 4 como máximo.
- Los prompts que cambian van como versión nueva. El validador de `packages/pipeline` rechaza una cifra o un dato que no esté en las respuestas de la persona. Tests primero.

### R33-05 · «Esto es lo que entendí»

IDs: C-26 a C-35.

Tal cual el informe:

- los ejemplos de guía se distinguen de lo cargado y llevan el estado «Sin completar»;
- «Quitar trabajo» separado, con confirmación y «Deshacer»; «Agregar otro trabajo»; «Agregar estudio o certificación»;
- habilidades con selector, chips y texto libre;
- idiomas con el nivel explicado, y varios idiomas;
- campos de resumen, blandas confirmadas y links;
- cierre «Guardar y ver mi CV»;
- se mantiene «Si algo está vacío, queda vacío: no lo completo yo».

### R33-06 · Diagnóstico

IDs: C-36 a C-42.

- **Palabra y número entero,** con los cortes de la sección 11 del plan. Tests primero en `cv-diagnosis.ts`, con los bordes.
- La frase fija sobre qué miden los niveles.
- Cada barra dice qué mide, con su ⓘ. «Legibilidad» y «Largo», separados.
- **Cada «falta» trae su botón al paso concreto** (la tabla 8.2 del informe). Si varias barras fallan por lo mismo, una sola acción principal.
- Se mantiene «Sumalas solo si de verdad las tenés».

### R33-07 · Contacto y links

IDs: C-43 a C-47.

- LinkedIn, portfolio y GitHub marcados si están cargados. Ciudad y país marcados («Incluye ciudad y país, no tu dirección»). El teléfono, sin marcar.
- La URL completa va como texto en el encabezado. Validación de `https` y «Abrir para probarlo».
- Aviso antes de descargar si el CV está incompleto.
- Los títulos de las secciones, en un solo idioma.

### R33-08 · PDF real

IDs: C-48 a C-55.

- **Se genera en el servidor,** desde el mismo modelo que el DOCX (`packages/pipeline/src/cv-out/`).
- **Dos capas:**
  - la composición (partir en líneas y en páginas, no cortar una viñeta, márgenes de A4) es lógica pura en `packages/pipeline`, con tests primero y sin la librería;
  - un adaptador fino que escribe el archivo con `pdf-lib`.
- **Si el guard no deja instalar `pdf-lib`:** dejá la primera capa completa y probada, el adaptador escrito, y en los pasos manuales el comando exacto y qué tests correr después.
- «Descargar PDF», archivo `CV-Nombre-Apellido.pdf`, A4, texto seleccionable, acentos y eñes bien, y links que se pueden tocar.
- El archivo es igual a la vista previa, que se actualiza sola. Estados de carga y de error.
- La descarga exige sesión, tiene rate limit y no deja el archivo en una URL pública.
- Las pruebas de C-55.
- **ADR nuevo** con la decisión y la dependencia.

### R33-09 · Calidad del CV

IDs: C-56 a C-62 y C-64 a C-69.

Tal cual el informe:

- el titular con el puesto y el resumen, arriba;
- «Actualidad» si el trabajo sigue;
- preguntas guía para pasar de tareas a logros sin inventar, con antes y después y conservando las palabras de la persona;
- categorías de habilidades según el rubro, y «Habilidades» en español;
- aviso suave si una habilidad no aparece en ninguna viñeta;
- aviso si falta Educación;
- el idioma con su nivel explicado;
- nunca un dato no confirmado («Español: nativo»).

### R33-10 · Legibilidad del CV

- Las reglas de la R30 pasan a modo estricto en todas las pantallas del CV: los dos asistentes, «Tu CV», la revisión, el diagnóstico y la vista previa.
- El script de auditoría las recorre. La lista de lo que no cumple va al informe, para la revisión de diseño.

### R33-11 · Calidad (lead)

- **e2e con el modelo simulado, por los dos caminos:** del primer mensaje al PDF descargado; cortar a la mitad y retomar el borrador; «Terminar y armar» con datos de menos; quitar un trabajo y deshacer.
- El PDF y el DOCX de un mismo CV dicen lo mismo.
- 390 y 360 px, teclado y axe.
- `verificacion-informe-ani.md` al día.

## Cierre

El de `docs/beta/cadena-r30-r34.md` §3. En los pasos manuales: las migraciones; `pdf-lib`, si no se pudo instalar; el paso del cron; las evals de los prompts nuevos; el guion para que Ani pruebe los dos caminos. Después, **seguí con la R34.**
