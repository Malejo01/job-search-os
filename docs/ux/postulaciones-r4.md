# Propuesta de UX/UI de `/applications` (R4-06)

Estado: propuesta, sin código de la app. Fecha: 6/11/2026. Se implementa en R4-07.

Origen: feedback de Mauro del 6/11, «la pantalla tiene demasiada información y demasiado scroll vertical».

## 1. Qué se midió

Se cargaron datos ficticios en la base local de desarrollo (persona B de los e2e): 20 ofertas, 17 con postulación, con empresas «Empresa A…T» y títulos inventados. Estados: 9 aplicadas (5 con seguimiento vencido, 1 postergada, 3 con más de 30 días), 2 en entrevista, 1 oferta, 3 rechazadas, 1 rechazo automático, 1 cerrada y 3 evaluadas sin aplicar (2 con más de 30 días sin tocar). Las capturas son locales en `ops/tanda-r4/capturas/r4-06/` (no versionadas).

| Ancho | Altura total de la página (hoy) | Sección «Para hacer seguimiento» | Filas de la lista |
|---|---|---|---|
| 390 px | 7664 px (claro y oscuro) | 2354 px, 9 tarjetas | 17 |
| 1280 px | 4795 px (claro y oscuro) | 1438 px, 9 tarjetas | 17 |

Por qué pesa tanto la pantalla (en las capturas):

1. Las 9 postulaciones con seguimiento aparecen dos veces: como tarjeta grande arriba y otra vez como fila de la lista de abajo.
2. Cada fila de la lista lleva su propio formulario (select de resultado, nota y «Guardar resultado»): son 17 formularios repetidos, y es lo que más altura ocupa (en el celular cada fila mide unos 270 px).
3. La calibración (tabla de 9 columnas con sorpresas) se muestra abierta apenas hay 5 postulaciones, antes de la lista.
4. Las postulaciones ya cerradas (rechazadas, cerradas) y las que llevan meses sin respuesta pesan lo mismo que lo que hay que hacer hoy.
5. Cada tarjeta de seguimiento repite tres controles de 44 px de alto, uno debajo del otro en el celular.

## 2. Qué necesita ver la persona primero

Orden de arriba hacia abajo. Cada postulación aparece en **un solo** grupo, con esta precedencia (la primera que cumpla):

| # | Grupo | Quién entra | Estado de la sección |
|---|---|---|---|
| 1 | **Para hacer seguimiento** (qué hacer hoy) | `followUpDue` verdadero y no inactiva (`listFollowUps`, ya existe) | Abierta siempre |
| 2 | **Activas** | `status` en `entrevista` u `oferta` (y no están en el grupo 1) | Abierta |
| 3 | **Esperando respuesta** | `status === "aplicada"`, `outcome === "sin_respuesta"`, menos de `INACTIVE_DAYS` desde la última novedad y sin seguimiento vencido | Abierta |
| 4 | **Sin respuesta (cerrada por inactividad)** | aplicada sin respuesta, 30 días o más sin novedades (regla de la sección 6), o `cerrada` con `outcome` sin respuesta | Colapsada |
| 5 | **Cerradas** | `rechazada`, `rechazo_automatico`, `cerrada`, `descartada` | Colapsada |
| 6 | **Ofertas descartadas por inactividad** | `evaluada` que nunca se aplicó, 30 días o más sin tocar | Colapsada |
| 7 | **Cómo viene la calibración** | el reporte actual, sin cambios de contenido | Colapsada siempre (hoy solo con menos de 5 postulaciones) |

Cada título lleva su contador: «Cerradas (5)». Un grupo vacío no se dibuja. Si no hay nada en 1 a 3, el estado vacío dice «Nada pendiente hoy» con los contadores de los grupos colapsados.

## 3. Jerarquía visual

Se reutilizan las primitivas de C9/C10 (`docs/ux/tokens.md`, `apps/web/components/ui/`): `cardClasses`, `buttonClasses`, `Badge`/`Chip`, `Icon`, `EmptyState`. Sin colores sueltos: solo tokens semánticos (`bg-surface`, `text-fg-muted`, `bg-warning-soft`, etc.). La lima solo en el botón principal.

- **Para hacer seguimiento**: el único bloque con tono (`cardClasses({ tone: "warning" })`, como hoy). Cada fila pasa de tarjeta con tres botones a **una línea compacta**: título (link), «Empresa · aplicada · hace N días» y, a la derecha en escritorio o debajo en el celular, un botón secundario «Ya hice seguimiento» y un link «Me respondieron». «Cerrar postulación» queda como `details` con confirmación, como hoy (mismas etiquetas: «Cerrar postulación» y «Sí, cerrar»).
- **Activas** y **Esperando respuesta**: filas planas dentro de un solo panel (`PANEL`), separadas por `border-line`, no una tarjeta por fila. Cada fila: título, línea de metadatos (empresa, canal, score) y la píldora de resultado (`OUTCOME_CLASSES`, ya existente) a la derecha.
- **Formulario de resultado**: se mantiene visible (select, nota y «Guardar resultado») solo en las filas de los grupos 2 y 3, que son pocas. En escritorio va en una sola línea con la fila. En los grupos colapsados va dentro de `details` «Cambiar resultado».
- **Grupos colapsados** (4, 5, 6 y 7): una fila de encabezado `min-h-11` con título, contador y un chevron (`Icon`), sobre `bg-surface-muted`. Cuerpo con las mismas filas planas, sin formulario de nota.
- Los títulos de los grupos son `h2` de `text-base font-bold`, para que el lector de pantalla recorra la página por grupos.

## 4. Cómo bajar el scroll a la mitad o menos

Estimación con los mismos datos ficticios (el cálculo es de filas por altura; se verifica con la misma captura en R4-07):

| Cambio | Ahorro en 390 px |
|---|---|
| Cada postulación aparece una sola vez (sin duplicar la tarjeta de seguimiento y la fila) | unos 2300 px |
| Las cerradas (5), las inactivas (3) y la calibración quedan plegadas: de unos 3300 px a unos 4 encabezados de 56 px | unos 3000 px |
| Filas planas de 80 a 110 px en vez de tarjetas de 270 px en los grupos abiertos | unos 800 px |
| Tarjetas de seguimiento compactas (de 260 a 110 px) | unos 900 px |

Resultado estimado: de 7664 px a unos **1700 a 2000 px** en el celular (menos de la cuarta parte), y de 4795 px a unos **1400 a 1700 px** en 1280 (menos de la mitad, casi un tercio). La meta de «la mitad o menos» se cumple con margen incluso si la estimación se queda corta por un 40 %.

El comportamiento con muchas más postulaciones (por ejemplo 60) mejora más: las cerradas y las inactivas, que son las que crecen, no suman altura mientras estén plegadas.

## 5. Accesibilidad

- Colapsables con `<details>/<summary>` donde alcanza (como ya hace la calibración). El client component de Framer Motion es el único que agrega animación, con `aria-expanded`, `aria-controls` y botón real (no un `div` clicable).
- `prefers-reduced-motion`: con `useReducedMotion()` la altura se cambia sin transición.
- Foco visible: `focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus` en cada resumen y botón (igual que hoy). Objetivos táctiles de 44 px (`min-h-11`).
- Estructura: un `h1`, un `h2` por grupo, listas reales (`ul`/`ol`) con el contador en el nombre accesible del grupo. La región de seguimiento conserva el nombre «Para hacer seguimiento» y el id `seguimiento` (el ancla `/applications#seguimiento` la usa «Hoy»).
- Contenido de un grupo colapsado fuera del orden de tabulación: con `details` cerrado el navegador ya lo oculta. En el client component, el panel cerrado lleva `hidden`, no solo altura 0.
- Los estados no dependen del color: cada píldora lleva texto («Sin respuesta», «Entrevista»). Contraste con los tokens ya validados con axe (`70-axe-sesion` y `88-axe-oscuro` revisan `/applications`).
- La tabla de calibración conserva su región con `tabIndex={0}` y `aria-label`.

## 6. Regla de inactividad (`INACTIVE_DAYS = 30`)

Funciones puras, calculadas al mostrar; no cambian la base solas.

**Postulación aplicada sin respuesta** (`status === "aplicada"` y `outcome === "sin_respuesta"`): está inactiva si pasaron `INACTIVE_DAYS` o más desde la última novedad, que es el máximo entre:

- `appliedAt`;
- `outcomeAt`;
- la fecha en que se postergó (`followUpAt` menos `FOLLOW_UP_SNOOZE_DAYS`, igual que `followUpDue`);
- `jobs.updated_at` (cualquier cambio de estado o corrección de la oferta; cubre la reactivación de una cerrada).

Se muestra como «Sin respuesta (cerrada por inactividad)» en el grupo 4 y **deja de aparecer** en «Para hacer seguimiento» (la inactividad gana sobre `followUpDue`).

**Oferta evaluada que nunca se aplicó** (`status === "evaluada"`, sin postulación): está inactiva si `jobs.updated_at` tiene `INACTIVE_DAYS` o más. Se muestra en el grupo 6 como «Descartada por inactividad». Hoy `/applications` no lista estas ofertas porque solo lee las que tienen postulación; hace falta una consulta nueva y chica.

**Botones** (todos reutilizan actions existentes; ver sección 7):

| Caso | Botón | Action existente |
|---|---|---|
| Aplicada inactiva: confirmar el cierre | «Cerrar por inactividad» | `closeApplicationAction(jobId)` |
| Aplicada inactiva: reactivar sin cambiar nada | «Reactivar» | `snoozeFollowUpAction(jobId)` (pone `follow_up_at = hoy + 7`, la novedad pasa a ser hoy y vuelve a «Para hacer seguimiento» en una semana) |
| Cerrada por inactividad (`status` cerrada, resultado sin respuesta): reactivar | «Reactivar» | `correctStatusAction` con `jobId` y `to = "aplicada"` |
| Evaluada inactiva: confirmar el descarte | «Descartar» | `changeStatusAction` con `jobId` y `event = "discard"` |
| Descartada: reactivar | «Reactivar» | `correctStatusAction` con `jobId` y `to = "evaluada"` |

Cada botón es un `<form action={...}>` con campos ocultos, sin JavaScript. «Cerrar por inactividad» y «Descartar» llevan la misma confirmación en dos pasos que «Cerrar postulación» (`details` + «Sí, …»).

Límites de lo que se propone, a propósito (la opción más simple):

- Una evaluada inactiva solo se puede descartar o abrir (link al detalle). No hay «Mantener», porque ninguna action existente toca `jobs.updated_at` sin cambiar el estado, y `snoozeFollowUpAction` falla si no hay postulación. **Parte roja opcional** si Mauro lo quiere: una action nueva en un `*actions.ts`.
- `correctStatusAction` a `aplicada` deja el resultado en `null`, que la pantalla ya lee como `sin_respuesta` (`asOutcome`), y actualiza `updated_at`, por eso la postulación reactivada no vuelve al grupo 4 en el acto.
- Riesgo conocido: una re-evaluación que dispare `applyJobEventIn` también actualiza `updated_at` y pospone la inactividad. Se acepta (re-evaluar es una novedad) y se anota en el código.

## 7. Qué es verde y qué sería rojo

Nada de esto exige editar un `*actions.ts`: los cinco botones usan `closeApplicationAction`, `snoozeFollowUpAction` (en `apps/web/app/(app)/applications/followup-actions.ts`) y `changeStatusAction` y `correctStatusAction` (en `apps/web/app/(app)/jobs/[id]/actions.ts`). Todos devuelven `void`, no redirigen al salir bien y `/applications` es `force-dynamic`, así que la página se refresca sola. `changeStatusAction` no revalida `/applications`, pero no hace falta por eso.

- **Verde**: `packages/pipeline/src/applications/**`, `apps/web/lib/applications.ts`, `apps/web/app/(app)/applications/page.tsx` y los componentes nuevos en `apps/web/components/`.
- **Rojo (solo si se agrega)**: «Mantener» una evaluada inactiva, o un botón que haga reactivar y postergar en un solo paso. No es parte de la propuesta base.

## 8. Plan de implementación (R4-07)

Archivos a tocar:

| Archivo | Cambio |
|---|---|
| `packages/pipeline/src/applications/inactivity.ts` (nuevo) | Constante y funciones puras |
| `packages/pipeline/src/applications/inactivity.test.ts` (nuevo) | Tests primero (regla del repo para `packages/pipeline`) |
| `packages/pipeline/src/index.ts` | Exportar lo nuevo (si el índice es verde; si no, avisar) |
| `apps/web/lib/applications.ts` | `listApplications` devuelve también `updatedAt`, `followUpAt` y `jobStatus`; función nueva `listStaleEvaluated(userId)` |
| `apps/web/app/(app)/applications/page.tsx` | Agrupar con las funciones puras y dibujar los grupos |
| `apps/web/components/applications/collapsible-group.tsx` (nuevo, client) | Expandir y colapsar con Framer Motion |
| `apps/web/components/applications/application-row.tsx` (nuevo, Server) | Fila plana con la píldora y el formulario opcional |
| `apps/web/components/applications/follow-up-row.tsx` (nuevo, Server) | Fila compacta de seguimiento |

Funciones puras nuevas (pipeline, sin I/O, la fecha entra por parámetro, ADR-001):

```ts
export const INACTIVE_DAYS = 30;

export type InactivityInput = {
  status: string;
  outcome: string | null;
  appliedAt: Date | null;
  outcomeAt: Date | null;
  followUpAt: Date | null;
  /** jobs.updated_at */
  touchedAt: Date | null;
};

/** Fecha de la última novedad (null si no hay ninguna fecha). */
export function lastActivity(input: InactivityInput): Date | null;

/** Aplicada sin respuesta y con INACTIVE_DAYS o más sin novedades. */
export function isInactiveApplication(input: InactivityInput, today: Date): boolean;

/** Evaluada sin postulación y con INACTIVE_DAYS o más sin tocar. */
export function isInactiveEvaluated(
  input: { status: string; touchedAt: Date | null },
  today: Date,
): boolean;

export type ApplicationGroup =
  | "seguimiento" | "activas" | "esperando" | "inactivas" | "cerradas";

/** Un solo grupo por postulación, con la precedencia de la sección 2. */
export function groupApplication(
  input: InactivityInput & { followUpDue: boolean },
  today: Date,
): ApplicationGroup;
```

Casos de test: justo 29 y 30 días; postergación reciente que reactiva; `outcomeAt` reciente; `updatedAt` reciente; entrevista y oferta nunca inactivas; `cerrada` con resultado sin respuesta cae en `inactivas`; precedencia (una vencida e inactiva va a `inactivas`).

Componentes:

- Server por defecto. `CollapsibleGroup` es el único `"use client"`: recibe `title`, `count`, `defaultOpen` y `children` (ya renderizados en el servidor) y anima la altura con Framer Motion (`AnimatePresence`, `useReducedMotion`). Sin estado persistente.
- La calibración se reutiliza tal cual dentro de `CollapsibleGroup`; el `details` `data-testid="calibracion-plegada"` se conserva para el caso de pocas postulaciones.

Cuidado con los e2e (grep de `/applications` en `apps/web/e2e/`):

| Spec | Qué depende de la pantalla | Riesgo |
|---|---|---|
| `04-resultado-postulacion.spec.ts`, `20-dos-usuarios.spec.ts`, `37-guardar-dos-veces.spec.ts` | `getByLabel("Resultado")` y `Guardar resultado` en la tarjeta de una postulación recién creada | Bajo: es del grupo «Esperando», que mantiene el formulario visible. Si alguno trabaja con una postulación vencida (7 días o más) el formulario no está en la fila de seguimiento |
| `67-seguimiento.spec.ts` | región «Para hacer seguimiento», `data-testid="seguimiento-item"`, textos «hace 10 días», «Ya hice seguimiento», «Me respondieron», «Cerrar postulación», «Sí, cerrar» | Alto: conservar testid, nombre de la región y textos exactos. La segunda tarjeta es una entrevista de hace 6 días, que sigue en «Para hacer seguimiento» |
| `69-hoy.spec.ts` | link a `/applications#seguimiento` y `seguimiento-item` | Conservar el id `seguimiento` |
| `70-axe-sesion`, `88-axe-oscuro`, `102-celular-oscuro`, `121-cambiar-tema`, `113-pestanas-celular`, `25-ensayo-invitacion` | solo cargan la ruta (axe, tema, celular) | Axe con grupos colapsados: sin regiones con scroll sin foco, sin ids duplicados, contraste en claro y oscuro |

Pruebas nuevas en R4-07: tests Vitest de las funciones puras, y un e2e (spec nuevo) que cree una aplicada de 40 días y verifique que aparece en «Sin respuesta (cerrada por inactividad)», que «Reactivar» la lleva fuera de ese grupo y que «Cerrar por inactividad» pone `cerrada` en la base. Medir de nuevo la altura de página con los mismos datos y anotarla en el PR.

Qué queda fuera de R4-07: cambiar la base con un proceso automático, «Mantener» una evaluada inactiva (parte roja), y tocar el contenido de la calibración.
