# Fuentes para las imágenes generadas (C7-2)

Las imágenes OG (`opengraph-image`, `twitter-image`, `opengraph-image-en`) se dibujan en el servidor
con `next/og`, que no puede usar `next/font`. Estas fuentes se leen del repo, nunca por red.

| Archivo | Fuente | Uso |
|---|---|---|
| `sora-800.woff` | Sora 800 | «AfinIA» del logotipo y título |
| `sora-300.woff` | Sora 300 | «Jobs» del logotipo |
| `manrope-600.woff` | Manrope 600 | Bajada |

Solo el subset latin, tomado del paquete `@fontsource` (v5.3.0). Licencia SIL Open Font License 1.1:
`OFL-Sora.txt` y `OFL-Manrope.txt`. La app en sí carga las fuentes con `next/font` (`app/fonts.ts`).
