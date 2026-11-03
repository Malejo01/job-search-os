# Ilustraciones de AfinIAJobs

Personajes ilustrados en estilo **E2 · editorial con trazo**: línea fina continua, rellenos planos parciales, paleta índigo, lima y lavanda. Las generó Mauro con Gemini (Nano Banana) desde su suscripción, usando `hoy` como referencia de estilo para todas. Decisión registrada en el rediseño del 3/11 (ronda 2).

## Archivos

Cada escena tiene dos tamaños en `apps/web/public/ilustraciones/`, en 4:3:

- `<escena>.webp`: 600 × 448 (pantallas comunes).
- `<escena>@2x.webp`: 1200 × 896 (pantallas de alta densidad, con `srcSet`).

Pesan entre 10 y 30 KB. Si una escena no tiene archivo, `<Illustration>` muestra el marcador del mismo tamaño.

## Dónde va cada una

| Escena | Estado | Dónde va | Fondo de la imagen | alt |
|---|---|---|---|---|
| `hoy` | ✅ | Cabecera curva de Hoy, a la derecha del saludo (en el celular, debajo o achicada) | Índigo `#1E1B4B`: va directo sobre la cabecera, sin recuadro | «» (decorativa) |
| `bienvenida` | pendiente | Primer ingreso / onboarding y email de bienvenida | Lavanda | «» |
| `cv` | pendiente | Mi CV, cuando todavía no hay CV | Lavanda | «» |
| `sin-descripcion` | pendiente | Ofertas sin descripción (pegar el texto del aviso) | Lavanda | «» |
| `vacio` | pendiente | Sin ofertas todavía (V3) | Lavanda | «» |
| `postulaciones` | pendiente | Postulaciones vacías | Lavanda | «» |
| `error` | pendiente | 404, `error.tsx` y `global-error.tsx` (F1) | Lavanda | «» |
| `acceso` | pendiente | Cabecera curva de `/acceso` | Índigo: va directo sobre la cabecera | «» |

## Lugares y medidas (C9-12)

Todas salen en 4:3: el alto es tres cuartos del ancho. El ancho lo fija la pantalla; la imagen de 600 px alcanza hasta 300 px de ancho en pantallas comunes y la @2x hasta 600 px en las de alta densidad.

| Escena | Lugar | Ancho en el celular (390 px) | Ancho en la computadora (1280 px) |
|---|---|---|---|
| `hoy` | Cabecera curva de Hoy, a la derecha del saludo | 96 px (achicada) | 208 a 240 px |
| `acceso` | Cabecera curva de `/acceso` | 120 px | 260 px |
| `bienvenida` | Arriba del primer paso del onboarding | 160 px | 220 px |
| `vacio`, `postulaciones`, `cv`, `sin-descripcion` | Estado vacío de su pantalla (V3), arriba del texto | 160 px | 200 px |
| `error` | Pantallas de error (404, `error.tsx`, `global-error.tsx`) | 200 px | 280 px |

**Peso máximo:** 40 KB por archivo (las de hoy pesan 13 y 30 KB). Si una pesa más, bajar la calidad de `cwebp` (`-q 75`).

## Cómo funciona en el código

- `packages/pipeline/src/illustrations.ts`: el manifiesto (`ILLUSTRATIONS`), con `available` y el fondo de cada escena. Un test (`illustrations.test.ts`) verifica que cada escena disponible tenga sus dos archivos y que no haya archivos fuera del manifiesto.
- `apps/web/components/brand/illustration.tsx`: `<Illustration escena="vacio" className="w-40 sm:w-52" />`. Server Component, sin animación. Si la escena no tiene imagen, muestra el **marcador**: el recuadro lavanda con el monograma, del mismo tamaño, así la pantalla no salta cuando llegue.
- Todas en `/settings/marca/componentes`, bloque «Ilustraciones».

## Reglas

- Las de fondo lavanda van siempre dentro de un recuadro lavanda `#EEEDF9` con radio de 32 px, **igual en claro y en oscuro**: así el fondo de la imagen se funde con el recuadro.
- Las de fondo índigo (`hoy`, `acceso`) van sobre la cabecera índigo, que es la misma en los dos modos.
- Todas son decorativas: el texto de al lado ya dice lo que pasa, así que llevan `alt=""`.
- Una ilustración por pantalla como máximo. Nunca en listas ni en tarjetas.
- Sin animación: no flotan ni entran con movimiento.

## Cómo sumar o cambiar una

1. Exportar en PNG 4:3 (1200 × 896 o mayor).
2. Convertir: `cwebp -q 82 -resize 1200 896 in.png -o <escena>@2x.webp` y `cwebp -q 82 -resize 600 448 in.png -o <escena>.webp`.
3. Copiar a `apps/web/public/ilustraciones/` y marcar la escena con ✅ en esta tabla.
4. En `packages/pipeline/src/illustrations.ts`, pasar la escena a `available: true` (si no, el test falla).
