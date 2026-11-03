# Fuentes de la marca (C9-2)

Bricolage Grotesque y Figtree, solo el subset latin (cubre ñ, tildes, ¿ y ¡), tomadas del paquete `@fontsource` (v5.3.0). Licencia SIL Open Font License 1.1: `OFL-BricolageGrotesque.txt` y `OFL-Figtree.txt`. Nada se baja por red, ni en el build ni en el navegador. Reemplazan a Sora y Manrope (C7-1).

| Archivos | Para qué |
|---|---|
| `bricolage-500.woff2`, `bricolage-700.woff2`, `bricolage-800.woff2`, `figtree-500.woff2` a `figtree-800.woff2` | La app, con `next/font/local` (`app/fonts.ts`) |
| `bricolage-800.woff`, `bricolage-500.woff`, `figtree-600.woff` | Las imágenes OG (`lib/og-image.tsx`): `next/og` no lee `woff2` ni `next/font` |

Para sumar un peso: `npm pack @fontsource/<familia>` en una carpeta temporal y copiar `files/<familia>-latin-<peso>-normal.woff2` con el nombre de esta carpeta.
