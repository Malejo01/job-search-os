# Fuentes de la marca (C7-1 y C7-2)

Sora y Manrope, solo el subset latin, tomadas del paquete `@fontsource` (v5.3.0). Licencia SIL Open
Font License 1.1: `OFL-Sora.txt` y `OFL-Manrope.txt`. Nada se baja por red, ni en el build ni en el
navegador.

| Archivos | Para qué |
|---|---|
| `sora-300.woff2`, `sora-700.woff2`, `sora-800.woff2`, `manrope-500.woff2`, `manrope-600.woff2`, `manrope-700.woff2` | La app, con `next/font/local` (`app/fonts.ts`) |
| `sora-800.woff`, `sora-300.woff`, `manrope-600.woff` | Las imágenes OG (`lib/og-image.tsx`): `next/og` no lee `woff2` ni `next/font` |
