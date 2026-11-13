# Carga sin streaming (R11-8)

## Qué se probó antes y por qué falló

El objetivo era un esqueleto mientras la pantalla se carga. Los dos intentos usaron streaming del servidor:

- **C6 (#456) y R8-0 vuelta 1 (#483):** `loading.tsx` en Hoy, Postulaciones, Ofertas, Emails, Mercado y Plan. Falló el e2e 20: con `loading.tsx` en `/jobs` e `/inbox`, los hijos `[id]` dan 404 con status 200 (el status ya salió con el esqueleto). Con `<Suspense>` en la página, el fallback rompe la navegación por searchParams (e2e 13, 21, 32, 79) y el modo sin JavaScript (89): el reemplazo del fallback es un script inline.
- **R8-0 vuelta 2 (#489):** solo Hoy y Postulaciones. Falló el e2e 79: cuando el contenido reemplaza al esqueleto, el foco del teclado sale de `main` («Saltar al contenido»). Además, sin JavaScript, el esqueleto no se reemplaza nunca.

Causa común: el esqueleto vivía en el servidor y cambia cómo se entrega la página (status, orden del HTML, foco).

## Diseño nuevo

Indicador solo en el cliente, en los links de la navegación (`useLinkStatus`, disponible en Next 15.5):

- `app/(app)/nav-pending.tsx` (componente nuevo): va dentro de cada `<Link>` de la barra de escritorio y de las pestañas del celular. Con `pending` dibuja una línea fina bajo el link y marca `main#contenido` con `aria-busy="true"`.
- No hay `loading.tsx` ni `<Suspense>`. Las páginas no se tocan.
- Tradeoff: no es un esqueleto del contenido, es un indicador en la navegación. Cualquier esqueleto del contenido necesita streaming o un contenedor cliente que reemplace `children`, y las dos cosas ya fallaron.

## Por qué no toca lo que rompió antes

- **Status HTTP, 404 y redirects:** el servidor responde lo mismo que hoy.
- **Sin JavaScript:** el componente es cliente y no se ejecuta; los links son `<a href>` normales, la página es la de hoy.
- **searchParams:** el indicador no cambia lo que se renderiza, solo marca el link.
- **Foco y «Saltar al contenido» (e2e 79):** no se reemplaza ningún nodo ni se mueve el foco. El indicador es un `span` `aria-hidden` con `pointer-events-none`, el nombre accesible del link no cambia, y `aria-busy` no mueve el foco.
- **Movimiento reducido:** sin transición ni pulso (`motion-reduce`); la línea aparece fija.
- **Saltos de diseño:** el `span` es `absolute`; hay 150 ms de espera para no parpadear en navegaciones rápidas.

## Pruebas

- e2e nuevo `apps/web/e2e/125-carga-navegacion.spec.ts` (retrasa la respuesta RSC): indicador y `aria-busy`, sin cambio de tamaño del link, sin animación con «reducir movimiento», 404 y 200 intactos. No corrió en local (el guard bloquea Playwright); lo corre el CI.
- Sin test unitario: `apps/web` no tiene entorno de componentes (sin jsdom ni testing-library) y no se suma una dependencia.

## Límite

Cubre la navegación desde la barra y las pestañas. Los links dentro de las páginas (tarjetas, filas) no muestran indicador; si hace falta, se envuelve su contenido con el mismo `NavPending`, sin tocar el servidor.
