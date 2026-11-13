# Accesibilidad con axe (R7-5)

## Qué se agregó

`apps/web/e2e/131-accesibilidad.spec.ts`: axe (reglas WCAG 2.0/2.1 A y AA) en claro y oscuro sobre:

- sin sesión: `/`, `/acceso`, `/precios` (se saltea si da 404 por `PRICING_ENABLED` apagado) y `/ayuda`;
- con sesión: `/hoy`, `/jobs`, `/jobs/[id]` (oferta ficticia sembrada con helpers), `/jobs/new`, `/cv` y `/settings/perfil`;
- el panel del asistente abierto (se saltea fuera del CI si el asistente no está encendido para el usuario e2e; en el CI, si falta la mascota, falla).

**Regla del test:** falla con violaciones `serious` o `critical`. Las `moderate` y `minor` no cortan: quedan como anotación (`a11y-leves`) y como adjunto de texto en el reporte de Playwright de cada test.

Dependencia: `@axe-core/playwright` 4.13.0 ya está declarada en `apps/web/package.json`; no hizo falta tocar `package.json` ni el lockfile.

## Estado de la medición

**Los e2e no corrieron en local** (la base local no tiene el usuario de e2e): los corre el CI. Por eso este documento no trae todavía una lista medida de violaciones `moderate` y `minor`. Después del primer CI con este spec, volcar acá las anotaciones `a11y-leves` en formato pantalla · regla · elemento.

Ya existía cobertura que falla con **cualquier** impacto en: `/hoy` (flujo 69), pantallas con sesión y públicas en oscuro (88), legales y cuenta (104), `/ayuda` (96), `/acceso` (95, 106), demo (103) y detalle de oferta (110). El flujo 131 suma lo que no estaba: `/precios`, `/jobs/new` y el panel del asistente abierto en claro y oscuro, y unifica el criterio de gravedad.

## Revisión de código (sin correr nada)

Leído: `apps/web/app/(app)/assistant-panel.tsx`. No se encontró ninguna violación `serious` o `critical` probable, y no se cambió ningún componente:

- `<dialog>` nativo con `showModal()` y `aria-labelledby` al título; foco al textarea al abrir.
- Todos los botones tienen texto; el textarea tiene `label`; los anuncios van en una región `role="status"` aparte.
- Foco visible con `focus-visible:outline` en los enlaces y el campo.

Candidatas a `moderate` para mirar en el primer reporte (no confirmadas):

| Pantalla | Regla probable | Elemento |
|---|---|---|
| Panel del asistente | `heading-order` | El título del panel es un `h2` y la página de fondo puede tener su `h1` fuera del diálogo; con el diálogo modal axe lo evalúa por separado |
| Panel del asistente | `region` (contenido fuera de landmarks) | Párrafos de ayuda dentro del `dialog` |

Contraste: los tokens de texto sobre fondos suaves (`text-warning` sobre `bg-warning-soft`, `text-danger` sobre `bg-danger-soft`) los mide `color-contrast` en el spec; no se calcularon a mano.

## R8 · segunda pasada (2026-11-13)

**Resultado: sin arreglos de código en esta pasada.** El e2e del PR #480 (run 43436317038) pasó, con los 131 en verde: 18 casos con medición (los dos `/precios` se saltean por `PRICING_ENABLED` apagado). Pasar significa que no hay violaciones `serious` ni `critical` en esas pantallas, en claro y oscuro.

En el run del #480 las `moderate` y `minor` no se pudieron leer: el spec las deja solo como anotación y adjunto del reporte HTML de Playwright, que el job `e2e` sube únicamente si falla (artefacto `playwright-traces`), y el log de GitHub no las imprime. Por eso el spec 131 ahora también escribe cada lista de leves en el log del CI con el prefijo `[a11y-leves]` (pantalla · regla (impacto): elemento).

**Medición con ese cambio (PR #484, run 43447183867):** el e2e pasó y el flujo 131 corrió en las 18 pantallas (las dos de `/precios` se saltean) sin imprimir ninguna línea `[a11y-leves]`. Con los tags `wcag2a`, `wcag2aa`, `wcag21a` y `wcag21aa` hay **0 violaciones moderadas y 0 leves**, además de 0 serias y 0 críticas. No hay nada que arreglar en código propio por esta vía y no se cambió ningún componente.

**Lo que esa medición no cubre:** `heading-order` y `region`, las dos candidatas de la tabla de arriba, son reglas «best-practice» de axe y el filtro de tags del spec no las evalúa. Siguen sin confirmar y sin descartar.

**Recomendación:** una pasada aparte que mida también las reglas `best-practice` (agregar el tag a `withTags`, o un spec separado para no cambiar el criterio del 131), con el mismo criterio: que no corte el CI, que imprima el resultado en el log y que se arreglen solo los problemas de código propio. No se hace en esta ronda.

## Qué queda afuera

- Correr el spec y volcar el resultado real (lo hace el CI).
- Reglas AAA y pruebas con lector de pantalla.
