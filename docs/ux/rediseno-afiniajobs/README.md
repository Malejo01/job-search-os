# Rediseño AfinIAJobs: fuente de diseño

Copia del lienzo «AfiniaJobs: manual de marca» (claude.ai, 30/10/2026), traída al repo el 2/11 para la tanda C7. Cada `.dc.html` es un artboard estático: HTML con estilos inline, se abre en el navegador (sin `support.js` no corre el script, pero el layout se ve igual). **Es referencia visual, no código para copiar**: la app usa los tokens de `apps/web/app/globals.css` y clases de Tailwind (ver `docs/ux/tokens.md`).

## Decisiones de Mauro (2/11)

- **Nombre:** se escribe **AfinIAJobs** en todas partes, incluidos el logo, las imágenes, el favicon, las imágenes OG, los emails y los textos legales. El manual dibuja el logo en minúsculas («afinia» + «jobs»): eso se reemplaza. El logotipo queda así:
  - «AfinIA» en Sora 800, naranja `#FF6A13` sobre oscuro o tinta `#050505` sobre claro;
  - «Jobs» en Sora 300, blanco sobre oscuro o naranja profundo `#C2410C` sobre claro;
  - mismo tracking negativo que el manual.
- **Alcance:** toda la app, pública y con sesión, más la pantalla **Hoy** nueva (P2).
- **Tema por defecto:** el del dispositivo (`prefers-color-scheme`), con el interruptor que ya existe.
- **Ani todavía no revisó la marca.** Los cambios que pida van a ser detalles: todo tiene que salir de tokens y de un solo componente de logo, para que ajustarlo sea un PR chico.

## Artboards

| Archivo | Qué es |
|---|---|
| `Main.dc.html` | Portada del manual |
| `M2-Logo.dc.html` | Logo, monograma (la «A» con el punto) y variantes sobre oscuro, claro y naranja; ícono de app y avatar |
| `M3-Uso.dc.html` | Usos correctos e incorrectos del logo |
| `M4-Color.dc.html` | Paleta: tinta, naranja, blanco, naranja profundo, neutros Stone, estados y modo oscuro |
| `M5-Tipografia.dc.html` | Sora (logo y títulos) y Manrope (texto); escala tipográfica |
| `M6-Iconos.dc.html` | 12 íconos de trazo de 24 px, con sus `path` |
| `M7-Voz.dc.html` | Voz y tono; bajada «Ofertas afines. CV afinado.» |
| `M8-Componentes.dc.html` | Botones, campo, avisos, score de 0 a 10, etiquetas y tarjeta de oferta |
| `P1-Ofertas.dc.html` | Pantalla Ofertas, escritorio |
| `P2-Hoy.dc.html` | Pantalla Hoy (nueva), escritorio |
| `P3-SinDescripcion.dc.html` | Pantalla Sin descripción, escritorio |
| `P4-Movil.dc.html` | Celular en modo oscuro |

## Tokens que salen del manual

| Uso | Claro | Oscuro |
|---|---|---|
| Tinta (texto, header) | `#050505` | — |
| Fondo de página | `#F5F5F4` | `#050505` |
| Superficie (tarjetas) | `#FFFFFF` | `#121212` |
| Borde | `#E7E5E4` | `#2A2A2A` |
| Texto secundario | `#57534E` | `#A8A29E` / `#D6D3D1` |
| Marca, acción (relleno) | `#FF6A13` con texto tinta (7,1:1) | `#FF6A13` con texto tinta |
| Naranja para texto sobre claro | `#C2410C` | `#FF6A13` |
| Foco | anillo naranja de 2 px con 2 px de separación | ídem |

- **Estados:** alto `#D1FAE5`/`#064E3B`, medio y riesgo `#FEF3C7`/`#78350F`, bajo `#F5F5F4`/`#44403C`, impide `#FEE2E2`/`#991B1B`, fuente o cola `#E0F2FE`/`#075985`.
- **Medidas:** radio 12 (tarjetas 16), espacio base 4, áreas táctiles de 44 px como mínimo.
- **Reglas del manual:** el naranja es de acción y nunca indica un estado; sobre blanco no se usa para texto.
- **Tipografías:** Sora 300/700/800 y Manrope 500/600/700, con `next/font/google`.
