# Tokens de diseño (N3-2, paleta AfinIAJobs en C7-1, rediseño C9)

Colores, radios y tipografía salen de un solo lugar: `apps/web/app/globals.css`. Las pantallas usan clases semánticas de Tailwind (`bg-surface`, `text-fg-muted`, `border-line`, `bg-danger-soft`) y nunca un color de la paleta (`bg-white`, `text-stone-700`, `text-red-800`). Así el modo oscuro y un cambio de marca se hacen en un archivo.

La fuente de los valores es el manual de marca: `docs/ux/rediseno-afiniajobs/` (README y `M4-Color`, `M5-Tipografia`, `M8-Componentes`).

## Cómo funciona

- Cada token es una variable `--jso-*` con un valor en `:root` (claro) y otro en `.dark` (oscuro). `.light` comparte el bloque de `:root`: sirve para mostrar claro dentro de una página en oscuro (la vitrina `/settings/marca`).
- Dentro de un `style` o de una clase arbitraria (`shadow-[…]`), usar `var(--jso-*)` y no `var(--color-*)`: Tailwind resuelve las `--color-*` en `:root`, así que no cambian dentro de un panel `.light` o `.dark`.
- `@theme inline` registra las clases de Tailwind (`--color-surface: var(--jso-surface)`), así la clase lee la variable en el momento y el cambio de `.dark` en `<html>` alcanza sin recompilar.
- Los valores van en hexadecimal: axe-core no sabe leer algunos `oklch` de Tailwind (tono `none`) y deja el contraste sin medir.
- `dark:` está definido por clase (`@custom-variant dark`) y queda para excepciones (una imagen, una sombra). Los colores no llevan `dark:`: el token ya cambia solo.

## Marca (paleta «índigo y lima», elegida por Mauro el 3/11)

Reemplaza a la «tinta y naranja» del manual (se parecía demasiado a otra marca). Las alternativas que se compararon están en el lienzo del manual, tablero «Alternativas de color».

| Color | Valor | Para qué |
|---|---|---|
| Índigo | `#1E1B4B` | Base de marca: header, bloques oscuros, texto del botón primario, logotipo «AfinIA» sobre claro |
| Lima | `#C6F25B` | Acción y marca: relleno del botón primario **con texto índigo** (12,4:1). Nunca indica un estado. Sobre claro no se usa como texto, ni como borde o foco (1,3:1) |
| Índigo vivo | `#4338CA` | El acento como texto, borde o foco sobre claro (7,9:1): links, «Jobs» sobre claro, foco en claro |
| Neutros | Escala Zinc fría (`#F5F5F7`, `#E4E4EA`, `#D4D4DC`, `#71717A`, `#52525B`, `#3F3F46`) | Fondos, bordes y textos secundarios |

Un elemento seleccionado (chip, pestaña) va con relleno lima y **borde índigo** (`border-brand-contrast`), así el estado se distingue también sobre blanco.

### Reglas de la lima (C9, decisión 2)

La lima va **solo** en tres lugares: el botón de acción principal, el sello «Muy afín» y la pestaña o píldora activa (navegación y filtros). Nunca como fondo de bloques grandes ni de secciones, nunca como texto sobre claro y nunca para indicar un estado. Índigo equilibrado: la cabecera es índigo (`bg-ink`) y el resto de la pantalla es claro.

## Colores

| Token (clase) | Para qué | Claro | Oscuro |
|---|---|---|---|
| `canvas` | Fondo de la página: lavanda en claro (C9-2) | `#EEEDF9` | `#14123A` |
| `surface` | Tarjetas, diálogos, campos | `#FFFFFF` | `#24215A` |
| `surface-subtle` | Recuadro dentro de una tarjeta | `#FAFAFC` | `#100E30` |
| `surface-muted` | Chips neutros, hover | `#F4F4F7` | `#2A2766` |
| `surface-strong` | Contadores | `#E4E4EA` | `#34316B` |
| `line` | Bordes de tarjeta y separadores | `#E4E4EA` | `#34316B` |
| `line-strong` | Botones secundarios, menú móvil | `#D4D4DC` | `#4B4890` |
| `line-control` | Campos de las pantallas que todavía no usan `Field` (3:1 o más, WCAG 1.4.11) | `#71717A` | `#8B89B8` |
| `line-ink` | Borde índigo (C10-2): botón secundario, oferta elegida | `#1E1B4B` | `#C7C6E6` |
| `fg` | Texto principal y títulos | `#14123A` | `#F5F5F7` |
| `fg-muted` | Texto secundario | `#3F3F46` | `#D4D4E0` |
| `fg-subtle` | Ayudas, fechas, pie | `#52525B` | `#A9A8C8` |
| `link` / `link-hover` | Links dentro del texto | `#4338CA` / `#3730A3` | `#C6F25B` / `#D9F78A` |
| `focus` | Anillo de foco (2 px, separación de 2). Los campos lo llevan siempre (regla base) además del borde | `#4338CA` | `#C6F25B` |
| `brand` / `brand-hover` / `brand-contrast` | Botón primario, su hover y su texto | `#C6F25B` / `#B4E046` / índigo | `#C6F25B` / `#D9F78A` / índigo |
| `brand-text` | El acento como texto (sección activa, acento) | `#4338CA` | `#C6F25B` |
| `ink` / `on-ink` / `on-ink-muted` / `ink-line` | Header y bloques índigo (iguales en los dos modos) | `#1E1B4B` / blanco / `#C7C6E6` / `#34316B` | ídem |
| `ink-accent` | Avatar de la barra (C10-3), índigo vivo sobre índigo | `#4338CA` | `#4338CA` |
| `on-strong` | Texto sobre un relleno fuerte de estado | blanco | blanco |
| `edge` | Borde inferior de lo blanco que se toca (tarjetas, botón secundario, chips) | `#D4D4DC` (línea fuerte) | `#4B4890` |
| `edge-brand` | Borde inferior del botón lima y del sello «Muy afín» | `#8FB82E` | `#8FB82E` |
| `edge-ink` | Borde inferior de un relleno índigo | `#0D0B2A` | `#0D0B2A` |
| `illustration` | Recuadro de las ilustraciones (decisión 15) | `#EEEDF9` | `#EEEDF9` |
| `seal` / `seal-line` / `seal-line-muted` | Sello de afinidad: relleno, anillo índigo (niveles altos y medios) y anillo gris (bajos; `#A1A1AA` desde C10-2, el del tablero) | blanco / `#1E1B4B` / `#A1A1AA` | `#24215A` / `#C7C6E6` / `#6F6DA3` |

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
| `--radius-container` | `rounded-container` | 2rem (32 px) | Contenedores: cabecera curva, recuadro de ilustración, paneles grandes |
| `--radius-card` | `rounded-card` | 1.5rem (24 px) | Tarjetas |
| `--radius-control` | `rounded-control` | 1.125rem (18 px) | Campos y avisos |
| `--radius-badge` | `rounded-badge` | 9999px | Etiquetas de las listas (píldora desde C9) |
| `--radius-pill` | `rounded-pill` | 9999px | Botones, chips, filtros, contadores, avatar |
| `--text-title` | `text-title` | 1.5rem / 1.875rem | `h1` de pantalla con sesión (el manual pide 28/34 en escritorio; 24 entra mejor a 390 px) |
| `--text-heading` | `text-heading` | 1.125rem / 1.75rem | `h2` de sección; los h2 de tarjeta siguen en `text-base` |

**Familias** (C9-2; `apps/web/app/fonts.ts`, con `next/font/local` y los archivos de `apps/web/assets/fonts`: subset latin, `display: swap`, servidas desde el mismo dominio y sin depender de la red en el build):

| Clase | Fuente | Pesos | Para qué |
|---|---|---|---|
| `font-sans` (por defecto) | Figtree | 500, 600, 700, 800 | El texto (500 y 600) y los botones (700 y 800). `body` va en 500 |
| `font-display` | Bricolage Grotesque | 500, 700, 800 | Títulos (700), el sello (800) y el logotipo («AfinIA» 800, «Jobs» 500). `h1`, `h2` y `h3` van en Bricolage por la capa base de `globals.css` |

Los espacios siguen la escala de Tailwind (`--spacing`, 0.25rem = el espacio base 4 del manual). Áreas táctiles: 44 px como mínimo (`min-h-11`); campos, selects y `summary` lo tienen por la capa base de `globals.css` (C7-15).

## Forma: plano con borde de abajo (C9-2, decisión 5)

Sin sombras. Lo que se toca lleva un borde inferior más grueso, de un tono más oscuro que su fondo, y al tocarlo se hunde 3 px.

| Clase | Qué hace | Dónde |
|---|---|---|
| `edge-6` | Borde inferior de 6 px | Tarjetas destacadas (`.card`: la mejor de Hoy, el detalle, el formulario de /acceso) |
| `edge-5` | Borde inferior de 5 px (C10-2) | Botones principal y secundario (`.btn`, `.btn2`) |
| `edge-4` | Borde inferior de 4 px | Tarjetas de las listas, chips y filtros |
| `border-edge` / `border-edge-brand` / `border-edge-ink` | Color del borde: blanco → línea fuerte; lima → `#8FB82E`; índigo → índigo hondo | Junto con `edge-4` o `edge-6` |
| `pressable` | Al tocar (`:active`) el borde de abajo cede 3 px y el de arriba crece 3 px transparente: lo de adentro baja 3 px y la caja mide lo mismo (nada salta, aunque tenga alto mínimo). Solo se hunde lo que tiene `edge-4` o `edge-6` | Todo lo que se toca. Es CSS: sirve en Server Components. Si tiene borde de arriba, su ancho va en `--jso-edge-top` (el botón secundario y los chips lo traen) |

Con «reducir movimiento» el hundimiento queda, sin transición.

**Contraste (C9-2).** Sobre el lavanda, todos los textos pasan AA: `fg` 15,4:1, `fg-muted` 9,0:1, `fg-subtle` 6,7:1, `link` 6,8:1 y los textos de estado entre 6,5 y 8,4:1. `line-control` queda en 4,2:1 (pide 3:1). El borde gris del sello pasa 3:1 contra su fondo en los dos modos (3,2 y 3,1); el borde índigo, 16:1 y 8,8:1. Lo verifican los e2e de axe (61, 70, 76, 77, 87, 88, 105).

## Piezas exactas de los tableros (C10-2)

Las pantallas aprobadas el 4/11 (`docs/ux/rediseno-afiniajobs/referencias/`) fijan las medidas. Dónde vive cada una:

| Tablero | Primitiva | Medidas |
|---|---|---|
| `.card` | `Card level="featured"` | Blanca, radio 24, borde 2 px `line-strong` y 6 abajo |
| `.cardl` | `Card level="list"` | Radio 24, borde 2 px `line` y 4 abajo. `selected`: borde `line-ink` |
| `.btn` | `Button` / `buttonClasses()` | Lima, texto índigo 800, 5 px abajo `edge-brand`; `md` 54 px, `lg` 56, `sm` 44 |
| `.btn2` | `variant="secondary"` | Blanco, borde 2 px `line-ink` y 5 abajo, texto 800 |
| `.ok` / `.fa` | `Chip tone="have"` / `"missing"` | `success-soft`/`success` con «✓» y `warning-soft`/`warning` con «!», 12 px 700, 4×10 |
| `.chip` / `.chipon` | `filterChipClasses()` | Borde 2 px `line-strong` y 4 abajo, 8×14, 13 px 700; elegido lima con borde índigo. Mide 38 px; el área táctil llega a 44 con un `::before` |
| `.field` / `.fl` | `Field`, `inputClasses()`, `labelClasses()` | Radio 18, borde 2 px `line-strong` y 4 abajo, 13×16, 15 px 600 (16 en el celular, para que iOS no haga zoom); etiqueta 13 px 800 |
| `.sello` | `Seal` | Círculo; número Bricolage 800, palabra Figtree 800; anillo de 2 px. `list` 56/62, `featured` 60/72, `detail` 78/88 (celular/computadora) |
| `.chk` / `.chk0` | `CheckMark` | Hecho: lima 26 px con «✓»; pendiente: aro de 3 px `brand-text` |
| `.logo` | `Logo` (`full`) | Ícono «A» de un trazo con el punto + «AfinIA» 800 y «Jobs» 500, 21/26 px |
| `.pill` / `.pon` | Píldoras de la barra | 14 px 700 `on-ink-muted`, 9×16; activa lima con texto índigo |
| `.tabs` / `.tab` | `MobileTabBar` | Blanca, borde de arriba 2 px `line`; 11 px 700; la activa con el ícono en una píldora lima de 44×28 |
| `.av` | `Avatar` | 40 px (34 en el celular), `ink-accent` con la inicial blanca 800 |

El catálogo `/settings/marca/componentes` muestra todas estas piezas en claro y en oscuro.

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
