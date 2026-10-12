# Panel · revisión transversal de accesibilidad (WCAG 2.1 AA)

Sesión de una persona sintética en la app local a 390 px (y a 640 px como aproximación al zoom del 200 %). Sin axe (no está instalado): árbol de accesibilidad, teclado, capturas y lectura del código.

**Pantallas:** `/login`, `/onboarding/skills`, `/jobs`, detalle de una oferta propia, `/market`, `/plan`, `/settings` y `/settings/skills`. `/settings/criteria`, solo por código.

**No probado:** 1280 px; recorrido completo con teclado (solo logo, Ajustes, Salir y el menú). No existe modo oscuro: no hay `dark:` ni `color-scheme` en `apps/web`. Los ítems "(por código)" no se verificaron en el navegador. Los contrastes son estimados desde las clases de Tailwind.

## Importantes
| # | Criterio | Hallazgo | Arreglo |
|---|---|---|---|
| 1 | 2.1.4 (A) | **Atajos de una sola tecla** (j, k, n) en el detalle (`review-nav.tsx:26-47`, `keydown` en `window`). Con dictado por voz o teclas pegadas se cambia de oferta sin querer | Alt+J, un interruptor en Ajustes o solo con el foco dentro de la navegación de revisión |
| 2 | 2.4.1 (A) | **No hay "Saltar al contenido".** Antes del contenido hay 10 o más paradas de tabulación | `<a href="#contenido" class="sr-only focus:not-sr-only …">` como primer hijo de `(app)/layout.tsx` y `onboarding/layout.tsx`, y `<main id="contenido" tabIndex={-1}>` |
| 3 | 2.4.2 (A) | **El mismo `<title>` en todas las pantallas** | `title: { template: "%s · <nombre>", default: … }` y `metadata.title` por página (se complementa con `PRODUCT_NAME` de la 29) |
| 4 | 1.3.1, 4.1.2 | **El menú principal no marca la sección actual** (`aria-current`) | Client component chico con `usePathname`: `aria-current="page"` y una clase visible |
| 5 | 2.4.7 (AA) | **Foco recortado en el menú horizontal** (`overflow-x-auto` recorta el outline; el degradé puede taparlo) | `focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-zinc-900` en los links |
| 6 | 2.4.6, 4.1.2 | **31 pares "Empezar"/"Cerrar" idénticos en `/plan`**, indistinguibles con lector | `aria-label={`${label} ${it.name}`}`, como "Quitar <skill>" |
| 7 | 3.3.2, 1.3.1 | **La ayuda queda dentro del `<label>` en `/settings/criteria`** (por código): el nombre accesible es todo el párrafo | Ayuda fuera del label, con `id` y `aria-describedby` |
| 8 | 3.3.1, 3.3.3 | **Errores sin vínculo con el campo** (criterios y login): un solo `role="alert"` arriba, sin `aria-invalid` ni foco | `aria-invalid`, `aria-describedby` y foco en el aviso |
| 9 | 1.4.3 (AA) | **Contraste:**<br>• `text-zinc-400` (≈ 2,5:1) en fechas de `/jobs` (`text-[11px]`), "sin recurso aprobado" y "—" del detalle;<br>• `text-zinc-500` en 12 px (≈ 4,6:1, al límite);<br>• el placeholder de "Nota";<br>• badges `bg-zinc-50 text-zinc-500` | `text-zinc-600` en todo texto menor a 14 px; `placeholder:text-zinc-500` |
| 10 | 1.4.11 (AA) | **Bordes de inputs y selects:** `border-zinc-300` sobre blanco (≈ 1,5:1) | `border-zinc-500` en la constante de inputs |
| 11 | (2.5.5 es AAA; pedido para el celular) | **Objetivos táctiles chicos:**<br>• "Ver oferta" (≈ 26 px);<br>• "Anterior"/"Siguiente" (≈ 26 px) y "← Ofertas" (≈ 16 px);<br>• "Empezar"/"Cerrar" (≈ 26 px, separados 4 px);<br>• links de Ajustes, Salir (≈ 20 px) y chips de rol (≈ 30 px).<br>Sí cumplen: los radios de skills, "Quitar" y el buscador | `min-h-11 inline-flex items-center px-3` |
| 12 | (2.3.3 es AAA; regla del proyecto) | **Sin `prefers-reduced-motion`:** Framer Motion en `job-list.tsx` y `animate-pulse` del "Evaluando…" | `<MotionConfig reducedMotion="user">` en un client component del layout; `motion-reduce:animate-none` |

## Pulidos
13. Códigos crudos (`location_risk`, "flags: …") y "Demanda 19.0" sin unidad. Un mapa `FLAG_LABELS`.
14. Título de la oferta truncado a una línea en 390 px (el link tiene `aria-label` completo). `line-clamp-2`.
15. Las acciones con redirect pierden el foco y no anuncian el resultado; "guardado: X" del score humano sin `role="status"`.
16. Al agregar una skill desde el buscador, el foco cae al `body` (2.4.3). Llevar el foco a la fila nueva y un `role="status"` "Agregaste X".
17. Los filtros de `/jobs` cambian la lista sin anunciarlo (4.1.3). `<p role="status" class="sr-only">{n} ofertas</p>`.
18. El link de la card cubre toda la tarjeta: funciona con teclado, pero no deja seleccionar el título. Aceptable.
19. Color como única señal: sin casos graves. Bloqueadores, riesgos y score siempre llevan texto o número.

## Lo que está bien
- `/login`: `lang="es"`, labels reales, `autoComplete`, `role="alert"`, foco visible y un solo `h1`.
- Un `h1` por pantalla y `h2` en orden.
- **`/settings/skills` y `/onboarding/skills`, el mejor ejemplo del producto:**
  - `fieldset`/`legend` por skill y radios con label;
  - `min-h-11` y foco propio;
  - `aria-current` en el rol, y "Quitar" con `aria-label`.
  Conviene replicar ese patrón de foco en el resto de la app, que hoy depende del outline por defecto del navegador.
- `/market`: tarjetas con `dl` en el celular y tabla con `th scope="col"` en escritorio, con `sr-only` por celda.
- Niveles dichos en palabras. Sin scroll horizontal a 640 px en `/jobs` ni en el onboarding.
- Filtros con `aria-label` y labels visibles; `<details>` nativos; "Ver oferta" con `rel="noopener noreferrer"`.
- `role="status"` en el aviso de evaluación.

## Top 3 por impacto y esfuerzo
1. "Saltar al contenido" y títulos por ruta (2 y 3): dos criterios de nivel A con cambios chicos.
2. Contraste de textos grises y bordes de inputs (9 y 10): reemplazo mecánico.
3. `aria-label` en los botones repetidos y objetivos táctiles (6 y 11). Y los atajos de una tecla (1): el único incumplimiento de nivel A que puede romper la navegación.
