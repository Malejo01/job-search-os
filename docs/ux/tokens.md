# Tokens de diseño (N3-2)

Colores, radios y tipografía salen de un solo lugar: `apps/web/app/globals.css`. Las pantallas usan clases semánticas de Tailwind (`bg-surface`, `text-fg-muted`, `border-line`, `bg-danger-soft`) y nunca un color de la paleta (`bg-white`, `text-zinc-700`, `text-red-800`). Así el modo oscuro y un cambio de marca se hacen en un archivo.

## Cómo funciona

- Cada token es una variable `--jso-*` con un valor en `:root` (claro) y otro en `.dark` (oscuro).
- `@theme inline` registra las clases de Tailwind (`--color-surface: var(--jso-surface)`), así la clase lee la variable en el momento y el cambio de `.dark` en `<html>` alcanza sin recompilar.
- En claro, los tokens valen exactamente lo que usaba la app antes: migrar una pantalla no cambia nada a la vista, salvo las equivalencias de la tabla de abajo marcadas con «≈».
- `dark:` está definido por clase (`@custom-variant dark`) y queda para excepciones (una imagen, una sombra). Los colores no llevan `dark:`: el token ya cambia solo.

## Colores

| Token (clase) | Para qué | Claro | Oscuro | Reemplaza |
|---|---|---|---|---|
| `canvas` | Fondo de la página | zinc-50 | zinc-950 | `bg-zinc-50` del `<body>` |
| `surface` | Tarjetas, header, diálogos, campos | white | zinc-900 | `bg-white` |
| `surface-subtle` | Recuadro dentro de una tarjeta | zinc-50 | zinc-950 | `bg-zinc-50` dentro de tarjetas |
| `surface-muted` | Chips neutros, hover, sección activa del menú | zinc-100 | zinc-800 | `bg-zinc-100` |
| `surface-strong` | Contadores | zinc-200 | zinc-700 | `bg-zinc-200` |
| `line` | Bordes de tarjeta y separadores | zinc-200 | zinc-800 | `border-zinc-200`, `border-zinc-100` (≈) |
| `line-strong` | Botones secundarios, menú móvil | zinc-300 | zinc-600 | `border-zinc-300` |
| `line-control` | Campos de formulario | zinc-400 | zinc-500 | `border-zinc-400`, `border-zinc-500` (≈) |
| `fg` | Texto principal y títulos | zinc-900 | zinc-50 | `text-zinc-900`, `text-zinc-800` (≈) |
| `fg-muted` | Texto secundario | zinc-700 | zinc-300 | `text-zinc-700` |
| `fg-subtle` | Ayudas, fechas, pie | zinc-600 | zinc-400 | `text-zinc-600`, `text-zinc-500` (≈, más contraste) |
| `link` | Links dentro del texto | sky-800 | sky-300 | `text-sky-800` |
| `focus` | Anillo de foco | zinc-900 | zinc-100 | `outline-zinc-900`, `ring-zinc-900` |
| `brand` / `brand-hover` / `brand-contrast` | Botón primario, su hover y su texto | zinc-900 / zinc-800 / white | zinc-100 / white / zinc-900 | `bg-zinc-900 text-white` |
| `on-strong` | Texto sobre un relleno fuerte de estado | white | white | `text-white` sobre `bg-emerald-700`… |

Estados: cada uno tiene texto, fondo suave, borde y relleno fuerte.

| Estado | `text-*` | `bg-*-soft` | `bg-*-muted` | `border-*-line` | `bg-*-strong` | Reemplaza |
|---|---|---|---|---|---|---|
| `success` | emerald-900 / emerald-200 | emerald-50 / emerald-950 | emerald-100 / emerald-900 | emerald-200 / emerald-800 | emerald-700 | `emerald-*`, `green-*` |
| `warning` | amber-900 / amber-200 | amber-50 / amber-950 | amber-100 / amber-900 | amber-200 / amber-800 | amber-700 | `amber-*` |
| `danger` | red-800 / red-200 | red-50 / red-950 | red-100 / red-900 | red-200 / red-800 | red-700 | `red-*` |
| `info` | sky-900 / sky-200 | sky-50 / sky-950 | sky-100 / sky-900 | sky-200 / sky-800 | sky-700 | `sky-*`, `blue-*` |

(claro / oscuro). En oscuro el texto de estado sube a los tonos 200 para pasar AA (4.5:1) sobre los fondos 950 y 900.

`-soft` es el fondo de un aviso o un panel. `-muted` es un fondo enfático para lo que tiene que resaltar en una lista: la caja del puntaje y los badges de bloqueador o duplicado. No usar `-muted` para avisos.

## Radios y tipografía

| Token | Clase | Valor | Para qué |
|---|---|---|---|
| `--radius-control` | `rounded-control` | 0.375rem | Botones, campos, avisos |
| `--radius-card` | `rounded-card` | 0.375rem | Tarjetas y paneles. Hoy igual a control; separarlo permite redondear tarjetas sin tocar botones |
| `--radius-badge` | `rounded-badge` | 0.25rem | Badges cuadrados de las listas |
| `--radius-pill` | `rounded-pill` | 9999px | Badges redondos y contadores |
| `--text-title` | `text-title` | 1.25rem / 1.75rem | `h1` de pantalla con sesión (hoy `text-xl`) |
| `--text-heading` | `text-heading` | 1.125rem / 1.75rem | `h2` de sección (hoy `text-lg`); los h2 de tarjeta siguen en `text-base` |

La vitrina pública usa títulos más grandes (`text-2xl` a `text-4xl`) y no lleva estos dos tokens.

Los espacios siguen la escala de Tailwind (`--spacing`, 0.25rem): no hace falta un token propio. La familia tipográfica es la de Tailwind por defecto (`--font-sans`).

## Tema claro u oscuro

`apps/web/app/theme-script.tsx` pone la clase `dark` en `<html>` antes de pintar. Lee `localStorage["jso-tema"]`: `claro`, `oscuro` o `sistema`.

Mientras haya pantallas sin migrar, el valor por defecto es `claro`: una pantalla con colores sueltos se vería a medias en oscuro. Para probar el oscuro a mano, en la consola del navegador:

```js
localStorage.setItem("jso-tema", "oscuro"); location.reload();
```

Cuando todas las pantallas usen tokens (ticket 4 de N3), `DEFAULT_THEME` pasa a `sistema` y se suma el selector en Ajustes.

## Diferencias conocidas con lo que había

- `danger` es red-800. Hay unos 22 `text-red-700`: al migrarlos quedan un tono más oscuros (más contraste).
- `line-control` es zinc-400, pero la mayoría de los campos hoy usa `border-zinc-300` (1,5:1 contra blanco). Migrarlos a `line-control` los oscurece un poco a propósito; aun zinc-400 queda debajo del 3:1 de WCAG 1.4.11, y se revisa en el ticket 4 (contraste AA).
- `success` es emerald-900; auth y perfil usan emerald-700 y green-800 para el mismo significado.

## Cómo saber qué falta migrar

```bash
# Colores de la paleta en un archivo o carpeta (debería dar 0 en lo migrado)
grep -rnE '\b(bg|text|border|outline|ring|divide|placeholder|from|to)-(white|black|zinc|red|amber|emerald|green|sky|blue)(-[0-9]+)?\b' apps/web/app/'(app)'/hoy
```

`bg-black/50` en el fondo de un `<dialog>` es la única excepción: oscurece lo de atrás en los dos modos.
