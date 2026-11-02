# Tokens de diseño (N3-2, paleta AfinIAJobs en C7-1)

Colores, radios y tipografía salen de un solo lugar: `apps/web/app/globals.css`. Las pantallas usan clases semánticas de Tailwind (`bg-surface`, `text-fg-muted`, `border-line`, `bg-danger-soft`) y nunca un color de la paleta (`bg-white`, `text-stone-700`, `text-red-800`). Así el modo oscuro y un cambio de marca se hacen en un archivo.

La fuente de los valores es el manual de marca: `docs/ux/rediseno-afiniajobs/` (README y `M4-Color`, `M5-Tipografia`, `M8-Componentes`).

## Cómo funciona

- Cada token es una variable `--jso-*` con un valor en `:root` (claro) y otro en `.dark` (oscuro).
- `@theme inline` registra las clases de Tailwind (`--color-surface: var(--jso-surface)`), así la clase lee la variable en el momento y el cambio de `.dark` en `<html>` alcanza sin recompilar.
- Los valores van en hexadecimal: axe-core no sabe leer algunos `oklch` de Tailwind (tono `none`) y deja el contraste sin medir.
- `dark:` está definido por clase (`@custom-variant dark`) y queda para excepciones (una imagen, una sombra). Los colores no llevan `dark:`: el token ya cambia solo.

## Marca

| Color | Valor | Para qué |
|---|---|---|
| Tinta | `#050505` | Texto principal en claro, fondo en oscuro, header |
| Naranja | `#FF6A13` | Acción y marca: relleno del botón primario **con texto tinta** (7,1:1). Nunca indica un estado. Sobre claro no se usa como texto |
| Naranja profundo | `#C2410C` | El naranja de texto sobre claro (links, logotipo «Jobs» sobre claro, foco en claro) |
| Neutros | Escala Stone (`#F5F5F4`, `#E7E5E4`, `#D6D3D1`, `#A8A29E`, `#78716C`, `#57534E`, `#44403C`) | Fondos, bordes y textos secundarios |

## Colores

| Token (clase) | Para qué | Claro | Oscuro |
|---|---|---|---|
| `canvas` | Fondo de la página | `#F5F5F4` | `#050505` |
| `surface` | Tarjetas, diálogos, campos | `#FFFFFF` | `#121212` |
| `surface-subtle` | Recuadro dentro de una tarjeta | `#FAFAF9` | `#0B0B0B` |
| `surface-muted` | Chips neutros, hover | `#F5F5F4` | `#1F1F1F` |
| `surface-strong` | Contadores | `#E7E5E4` | `#2A2A2A` |
| `line` | Bordes de tarjeta y separadores | `#E7E5E4` | `#2A2A2A` |
| `line-strong` | Botones secundarios, menú móvil | `#D6D3D1` | `#44403C` |
| `line-control` | Campos de formulario (3:1 o más, WCAG 1.4.11) | `#78716C` | `#78716C` |
| `fg` | Texto principal y títulos | `#050505` | `#F5F5F4` |
| `fg-muted` | Texto secundario | `#44403C` | `#D6D3D1` |
| `fg-subtle` | Ayudas, fechas, pie | `#57534E` | `#A8A29E` |
| `link` / `link-hover` | Links dentro del texto | `#C2410C` / `#9A3412` | `#FF6A13` / `#FB923C` |
| `focus` | Anillo de foco (2 px, separación de 2) | `#C2410C` | `#FF6A13` |
| `brand` / `brand-hover` / `brand-contrast` | Botón primario, su hover y su texto | `#FF6A13` / `#EA580C` / tinta | `#FF6A13` / `#FB923C` / tinta |
| `brand-text` | Texto naranja (sección activa, acento) | `#C2410C` | `#FF6A13` |
| `ink` / `on-ink` / `on-ink-muted` / `ink-line` | Header y bloques tinta (iguales en los dos modos) | `#050505` / blanco / `#D6D3D1` / `#2A2A2A` | ídem |
| `on-strong` | Texto sobre un relleno fuerte de estado | blanco | blanco |

Estados (manual M4): cada uno tiene texto, fondo suave, fondo enfático, borde y relleno fuerte.

| Estado | `text-*` | `bg-*-soft` (avisos) | `bg-*-muted` (etiquetas, score) | `border-*-line` | `bg-*-strong` |
|---|---|---|---|---|---|
| `success` (score alto, ubicación ok) | `#064E3B` / `#A7F3D0` | `#ECFDF5` / `#022C22` | `#D1FAE5` / `#064E3B` | `#A7F3D0` / `#065F46` | `#047857` |
| `warning` (score medio, riesgo) | `#78350F` / `#FDE68A` | `#FFFBEB` / `#2A1606` | `#FEF3C7` / `#78350F` | `#FDE68A` / `#92400E` | `#B45309` |
| `danger` (impide postular) | `#991B1B` / `#FECACA` | `#FEF2F2` / `#2A0A0A` | `#FEE2E2` / `#7F1D1D` | `#FECACA` / `#991B1B` | `#B91C1C` |
| `info` (en cola, fuente) | `#075985` / `#BAE6FD` | `#F0F9FF` / `#082033` | `#E0F2FE` / `#0C4A6E` | `#BAE6FD` / `#075985` | `#0369A1` |

(claro / oscuro). El score bajo y la etiqueta neutra usan `surface-muted` con `fg-muted` (`#F5F5F4` / `#44403C` del manual).

`-soft` es el fondo de un aviso o un panel. `-muted` es un fondo enfático para lo que tiene que resaltar en una lista: la caja del puntaje y las etiquetas. No usar `-muted` para avisos.

**Contraste.** Todos los pares texto/fondo de las tablas pasan AA (4,5:1) en los dos modos, salvo `link` sobre `surface-strong` en claro (4,1:1): no poner links sobre contadores. El script de chequeo está en el PR de C7-1; los e2e de axe (61, 70, 76, 77, 87, 88) lo verifican sobre las pantallas.

## Radios y tipografía

| Token | Clase | Valor | Para qué |
|---|---|---|---|
| `--radius-control` | `rounded-control` | 0.75rem (12 px) | Botones, campos, avisos |
| `--radius-card` | `rounded-card` | 1rem (16 px) | Tarjetas y paneles |
| `--radius-badge` | `rounded-badge` | 0.375rem (6 px) | Etiquetas de las listas |
| `--radius-pill` | `rounded-pill` | 9999px | Badges redondos, contadores, avatar |
| `--text-title` | `text-title` | 1.5rem / 1.875rem | `h1` de pantalla con sesión (el manual pide 28/34 en escritorio; 24 entra mejor a 390 px) |
| `--text-heading` | `text-heading` | 1.125rem / 1.75rem | `h2` de sección; los h2 de tarjeta siguen en `text-base` |

**Familias** (`apps/web/app/fonts.ts`, con `next/font/google`: subset latin, `display: swap`, servidas desde el mismo dominio):

| Clase | Fuente | Pesos | Para qué |
|---|---|---|---|
| `font-sans` (por defecto) | Manrope | 500, 600, 700 | Todo el texto de la app |
| `font-display` | Sora | 300, 700, 800 | Logo y títulos. Todo `h1` va en Sora por la capa base de `globals.css` |

Los espacios siguen la escala de Tailwind (`--spacing`, 0.25rem = el espacio base 4 del manual). Áreas táctiles: 44 px como mínimo (`min-h-11`).

## Tema claro u oscuro

`apps/web/app/theme-script.tsx` pone la clase `dark` en `<html>` antes de pintar. Lee `localStorage["jso-tema"]`: `claro`, `oscuro` o `sistema`. **Sin preferencia vale `sistema`** (C7-1): la app sigue a `prefers-color-scheme` del dispositivo, y cambia sola si el dispositivo cambia.

La preferencia se elige en **Ajustes → Apariencia** (`settings/theme-select.tsx`): «Como el dispositivo», «Claro» u «Oscuro».

## Cómo saber qué falta migrar

```bash
# Colores de la paleta en un archivo o carpeta (debería dar 0 en lo migrado)
grep -rnE '\b(bg|text|border|outline|ring|divide|placeholder|from|to)-(white|black|zinc|stone|red|amber|emerald|green|sky|blue|orange)(-[0-9]+)?\b' apps/web/app/'(app)'/hoy
```

Excepciones a propósito, las únicas con color de la paleta:

- `bg-black/50` (o `/40`) en el fondo de un `<dialog>` o un modal: oscurece lo de atrás en los dos modos.
- `bg-white [color-scheme:light]` en el `iframe` del email (`/inbox/[id]`): el HTML de afuera trae sus colores, casi siempre texto oscuro sin fondo, y sobre un fondo oscuro no se leería.
- `cv-preview.tsx` (`.cv-sheet`): emula una hoja de papel físico en pantalla y al imprimir; mantiene fondo blanco (`bg-white`) y texto oscuro fijos en ambos modos (`[color-scheme:light]`) para que la impresión y exportación a PDF no genere texto claro sobre papel blanco.
