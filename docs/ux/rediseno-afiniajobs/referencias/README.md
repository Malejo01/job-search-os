# Referencias visuales del rediseño (C10)

Pantallas finales aprobadas por Mauro el 4/11 en el lienzo «AfiniaJobs: manual de marca», sección «Pantallas finales». **La app tiene que verse igual que estas imágenes**, en celular (390 px) y en PC (1280 px). Las PNG están a 2x.

| Imagen | Pantalla | Ancho |
|---|---|---|
| `portada-pc.png` / `portada-cel.png` | `/` sin sesión | 1280 / 390 |
| `acceso-pc.png` / `acceso-cel.png` | `/acceso` | 1280 / 390 |
| `hoy-pc.png` / `hoy-cel.png` | `/hoy` | 1280 / 390 |
| `ofertas-pc.png` | `/jobs` en PC, con el detalle al lado (`?oferta=<id>`) | 1280 |
| `ofertas-cel.png` | `/jobs` en el celular | 390 |
| `detalle-cel.png` | `/jobs/[id]` en el celular | 390 |

`S1-publicas.html` y `S2-hoy-ofertas.html` son el código de esos tableros: **las medidas, colores, radios, bordes, pesos y tamaños de letra exactos salen de sus estilos** (clases `.card`, `.cardl`, `.btn`, `.btn2`, `.sello`, `.muy`, `.bas`, `.gris`, `.chip`, `.field`, `.pill`, `.tabs`, etc.). Ante la duda entre la imagen y el código, manda el código.

Los recuadros punteados «Ilustración acceso» son el lugar de una ilustración que todavía no existe: en la app va el marcador de `<Illustration escena="acceso">`.
