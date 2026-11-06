# Ilustraciones de AfinIAJobs

Personajes ilustrados en estilo **E2 · editorial con trazo**: línea fina continua, rellenos planos parciales, paleta índigo, lima y lavanda. Las generó Mauro con Gemini (Nano Banana) desde su suscripción, usando `hoy` como referencia de estilo para todas. Decisión registrada en el rediseño del 3/11 (ronda 2).

## Archivos

Cada escena tiene dos tamaños en `apps/web/public/ilustraciones/`, en 4:3:

- `<escena>.webp`: 600 × 448 (pantallas comunes).
- `<escena>@2x.webp`: 1200 × 896 (pantallas de alta densidad, con `srcSet`).

Pesan entre 8 y 38 KB (la de `acceso`, con cuatro personas, es la más pesada). Se muestran con `<Illustration scene="…" />` (`apps/web/components/ui/illustration.tsx`), que usa `next/image` con un loader propio (`apps/web/lib/illustration-loader.ts`): el `srcSet` toma estos dos archivos tal cual, sin pasar por el optimizador de Next.

## Dónde va cada una

| Escena | Estado | Dónde va | Fondo de la imagen | alt |
|---|---|---|---|---|
| `hoy` | ✅ archivo · se coloca con C9 | Cabecera curva de Hoy, a la derecha del saludo (en el celular, debajo o achicada) | Índigo `#1E1B4B`: va directo sobre la cabecera, sin recuadro | «» (decorativa) |
| `bienvenida` | ✅ | Primer paso del onboarding (`/onboarding`): arriba del título en el celular, a la derecha desde `sm`. El email de bienvenida queda afuera (ver abajo) | Lavanda | «» |
| `cv` | ✅ | Tu CV (`/cv`) cuando todavía no hay CV: sin perfil o sin ninguna sección cargada | Lavanda | «» |
| `sin-descripcion` | ✅ | `/jobs/pending-jd`, columna izquierda, entre la explicación y los pasos | Lavanda | «» |
| `vacio` | ✅ | `/jobs` cuando la persona todavía no tiene ninguna oferta (V3) | Lavanda | «» |
| `postulaciones` | ✅ | `/applications` sin postulaciones | Lavanda | «» |
| `error` | ✅ | 404 (`not-found.tsx`, también el público), `error.tsx` y `global-error.tsx` (F1) | Lavanda | «» |
| `acceso` | ✅ | Bloque índigo de marca de `/acceso`, entre la bajada y la lista (cuando exista la cabecera curva, va en ella) | Índigo: va directo sobre el bloque | «» |

## Reglas

- Las de fondo lavanda van siempre dentro de un recuadro lavanda `#EEEDF9` con radio de 32 px, **igual en claro y en oscuro**: así el fondo de la imagen se funde con el recuadro.
- Las de fondo índigo (`hoy`, `acceso`) van sobre la cabecera índigo, que es la misma en los dos modos.
- Todas son decorativas: el texto de al lado ya dice lo que pasa, así que llevan `alt=""`.
- Una ilustración por pantalla como máximo. Nunca en listas ni en tarjetas.
- Sin animación: no flotan ni entran con movimiento.
- El recuadro lavanda usa el token `illustration` (`#EEEDF9`, igual en claro y en oscuro; ver `docs/ux/tokens.md`). En `global-error.tsx` no hay Tailwind y el recuadro va con estilos en línea.
- `/ui` muestra las ocho escenas juntas para revisarlas en claro y en oscuro; el e2e 87 las pasa por axe.

## Cuál se eligió de cada escena (serie del 6/11)

Cada escena se generó en tres variantes (`E2-<escena>-<n>.png`); se eligió una con estos criterios: que sea coherente con `hoy` (mismo trazo, rellenos parciales y paleta, sin colores fuera de la paleta como la maceta terracota), que no copie la pose ni la tarjeta de la referencia, que sea legible a 224–384 px de ancho, que no tenga nada que se lea como texto y que cumpla la escena pedida en `PROMPT-ANTIGRAVITY-2-serie.md`. La tabla con el motivo de cada una está en el PR `feat/ilustraciones-serie-e2`. Si Ani pide otra variante, se reconvierte y se reemplazan los dos `.webp`; no hay que tocar código.

Para que el fondo de la imagen se funda con el recuadro (los PNG traían un lavanda levemente distinto en cada una, por ejemplo `#E9E7FC`, y el índigo salía `#212354` en vez de `#1E1B4B`), antes de exportar se «clavó» el fondo liso al color exacto del token. Solo se tocan los píxeles casi iguales al fondo.

## Fuera de esta serie

- **Email de bienvenida:** la guía lo nombra, pero un email necesita una imagen con URL absoluta y en PNG o JPG (Outlook de escritorio no muestra WebP) y un `alt` pensado para cuando se bloquean las imágenes. Queda para un ticket aparte.
- **`hoy`:** el archivo ya está; se coloca en la cabecera curva con la tanda C9.
- **`alt` descriptivo:** todas son decorativas (`alt=""`), como pide la regla de arriba. Si Ani prefiere que alguna describa la escena, `<Illustration>` es el único lugar donde cambiarlo.

## Cómo sumar o cambiar una

1. Exportar en PNG 4:3 (1200 × 896 o mayor).
2. Convertir: `cwebp -q 82 -resize 1200 896 in.png -o <escena>@2x.webp` y `cwebp -q 82 -resize 600 448 in.png -o <escena>.webp`.
3. Copiar a `apps/web/public/ilustraciones/` y marcar la escena con ✅ en esta tabla.
4. Si la escena es nueva, sumarla a `ILLUSTRATION_SCENES` en `illustration.tsx` (con su tipo de fondo, `lavender` o `ink`) y a la vitrina de `/ui` (sale sola de esa lista).
