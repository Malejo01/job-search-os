Tanda R34 «Barrido y cierre». Armá un **EQUIPO DE AGENTES** con 3 teammates y vos como lead. Mecánica, reglas y cierre: `docs/beta/cadena-r30-r34.md`. Especificación: `docs/beta/plan-r30-r34.md` (secciones 7, 9, 12 y 14).

- Ramas `ronda/r34-NN-<nombre>`. e2e: 440 a 459. Bloque 52 del BACKLOG.
- **Base:** `origin/ronda/r33-integracion` si existe; si no, `origin/ronda/r33-cierre`.
- Es la última tanda de la cadena. **Cuando cierre, terminá.**

## Reglas propias de esta tanda

- **Ningún modelo nuevo.** «Adaptar a esta oferta» usa el prompt `cv_tailor` que ya existe, con el modelo simulado.
- **Nada se envía desde la app** (ADR-004): «Preparar mi postulación» termina en un enlace al aviso.
- **`/market` va en su versión mínima.** El rediseño completo queda para después de abrir. Si existe `ops/rondas/r34-tanda/ronda-7.md`, tiene las decisiones del responsable y de Ani sobre mercado: valen esas. Si no existe, hacé solo lo que dice R34-03.
- **Los arreglos del ensayo con personas no entran acá:** el ensayo es posterior. Acá se deja todo listo para hacerlo.

## Equipo y tickets

| Teammate | Tickets en orden |
|---|---|
| **legibilidad** | R34-01 |
| **postulacion** | R34-02 → R34-05 |
| **mercado** | R34-03 → R34-04 |

El lead hace R34-06 al final.

### R34-01 · Barrido de legibilidad

- Las reglas de la R30 pasan a modo estricto en **todas las pantallas de usuario** que faltan: Hoy, bandeja, postulaciones, Interview, Academy, plan, configuración, ayuda, el alta, el asistente y las páginas públicas. La lista de excepciones tiene que quedar vacía, salvo el admin.
- Nada debajo de 12 px, ningún texto con transparencia, y lo necesario para decidir, en 14 px o más.
- El script de auditoría recorre todo en claro y oscuro, a 390 y 1280 px y con zoom al 200 %. El resultado va al informe, para la revisión de diseño.
- Las páginas públicas siguen estáticas y la portada no empeora su LCP.

### R34-02 · El CV desde la oferta

IDs: R-36 a R-38.

Dentro de «Preparar mi postulación», tres acciones. Revisá `packages/pipeline/src/cv-for-offer.ts`, `cv-tailor/` y `cv-offer-download.ts` antes:

- **«Revisar mi CV para esta oferta»:** qué de lo que pide el aviso ya aparece en el CV, qué no tiene respaldo y qué conviene aclarar. Se calcula con la tabla de requisitos y el CV de la persona.
- **«Adaptar a esta oferta»:** sugerencias para aceptar, editar o descartar una por una, con vista previa antes de guardar. Se guarda como **otra versión:** el CV base no se pisa.
- **Elegir la versión y descargarla,** en PDF o en DOCX, y de ahí el botón de salida al aviso.
- Ninguna sugerencia suma algo que la persona no declaró.

### R34-03 · `/market` mínimo

IDs: C-70 a C-72.

Hoy la pantalla muestra muchos datos juntos y sin orden. La versión mínima responde pocas preguntas, **para la carrera de la persona** y solo con avisos vigentes:

- cuántas ofertas hay hoy, cuántas puede tomar desde su país y cuántas son para quien empieza;
- qué habilidades piden más, y cuáles de esas ya tiene cargadas;
- en qué modalidad y desde dónde;
- qué sueldos se publican, en la moneda original y solo si hay casos suficientes para decirlo.

Además:

- cada dato dice de cuántos avisos sale y de qué fecha es;
- con menos de 10 avisos no hay gráfico: se dice que todavía hay pocos datos;
- cada bloque termina en una acción: ver esas ofertas o cargar esa habilidad;
- lo que no entra en esta versión se saca de la pantalla, no se esconde plegado.

### R34-04 · Seguimiento mínimo

- En «Ya me postulé», cada oferta muestra la fecha de la postulación y un estado que la persona cambia a mano. Si el dato ya está guardado, también la versión del CV que se usó. Sin migraciones para esto.
- Sin recordatorios automáticos ni predicciones. El tablero completo queda para después de abrir.

### R34-05 · Ensayo de punta a punta

- **Un e2e largo,** con el modelo simulado: alta con carrera; primera oferta; evaluación con una pregunta de un toque; guardar; armar el CV por el camino «No tengo CV»; revisar el CV para la oferta; descargar el PDF; ir al aviso y marcar «Ya me postulé».
- **`docs/beta/ensayo-beta.md`:** el guion para probar con 5 personas. Qué se les pide, qué se mira sin intervenir, cuándo se cuenta como recorrido completo y qué anotar.

### R34-06 · Cierre de la cadena (lead)

- 390 y 360 px, teclado y axe, en lo tocado.
- **`docs/beta/verificacion-informe-ani.md` completa:** los 159 puntos con su estado final. Lo que quedó parcial o pendiente, con el motivo.
- **`docs/beta/informe-cadena-r30-r34.md`:** qué quedó hecho; qué falta para la compuerta A y para la B, punto por punto según la sección 14 del plan; y los pasos manuales de las cinco tandas juntos y en orden.

## Cierre

El de `docs/beta/cadena-r30-r34.md` §3. **No sigas con otra tanda.**
