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
