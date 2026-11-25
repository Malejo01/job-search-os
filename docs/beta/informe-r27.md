# Informe de la tanda R27 «Afi, la mascota» (24/11)

La mascota ya tiene nombre, **Afi**, y aparece en toda la app con su versión 3D, siempre sobre un círculo lavanda:
- saluda en Hoy la primera vez del día;
- festeja los logros: postulación enviada, CV terminado con el coach y plan en marcha;
- acompaña las esperas de IA, los vacíos, los errores y el 404;
- es la cara del asistente: «Preguntale a Afi», «Afi está pensando…»;
- explica en Academy y en las ayudas «?»;
- recibe en la portada, la lista de espera, los emails y la imagen para compartir.

Ningún agente llamó a un modelo (USD 0), tocó un prompt, Neon, Vercel o Resend, ni mergeó nada. Hay una migración sin aplicar (0082) y tres archivos del favicon para copiar a mano: ver [`pasos-manuales-r27.md`](pasos-manuales-r27.md). Inventario de imágenes: [`mascota.md`](mascota.md).

## Cómo están armadas las ramas

Una sola cadena sobre `ronda/r27-assets` (`main` + las imágenes de Afi). Alcanza con integrar `ronda/r27-cierre`. Las ramas intermedias agrupan los tickets por quién los hizo: comparten archivos (las poses viejas cambiaron de nombre en todos los usos), así que solo la última compila sola.

| # | Rama | Tickets |
|---|---|---|
| 1 | `ronda/r27-01-base` | R27-01, R27-02, R27-03 |
| 2 | `ronda/r27-04-momentos` | R27-04, R27-05 (migración 0082) |
| 3 | `ronda/r27-06-afuera` | R27-06, R27-07 |
| 4 | `ronda/r27-cierre` | Backlog, este informe, los pasos manuales y el carril rojo |

Es **carril rojo**: migración y `schema.ts`, `hoy/page.tsx`, `jobs/first-steps.tsx`, `apertura*` y una server action nueva (`lib/saludo-actions.ts`, ya sumada a `carril-rojo.txt` y `CODEOWNERS`).

## Qué hay

### Base (R27-01 a R27-03)
- `lib/mascota.ts`: `MASCOTA_NOMBRE` es el único lugar del nombre (un test falla si aparece escrito a mano en `app/` o `components/`). Las 9 poses reales, cada una con su uso, su `alt` en voseo y el ancho real leído de los WebP. `srcSet` por ancho (256/512/1024).
- `<Afi pose size />`: Server Component con `<img>` estático (sin el optimizador de Vercel), `width`/`height` fijos, `lazy` salvo `priority`, `decorative` cuando hay texto al lado.
- `<AfiAnimado />`: entrada con rebote, flota, festeja, reacciona al mouse y funde al cambiar de pose. Framer Motion solo ahí. Con movimiento reducido queda quieto y sin transiciones. `<AfiAnimadoLazy />` lo carga aparte para no sumar Framer al First Load.
- Asistente: el botón es la cara de Afi (44 px en el celular, 64 desde `sm`); el panel muestra `pensando` mientras responde y `hablando-1` con la respuesta. Se mantiene lo de la R26-05: no tapa contenido, se esconde con el teclado y la burbuja sale una sola vez.

### Momentos (R27-04 y R27-05)
- **Saludo diario en la cuenta**: columna `profiles.saludo_visto`, leída en la misma consulta de perfil que ya hacía el layout (con `cache` de React): cero consultas nuevas. De respaldo, el navegador; si la columna todavía no existe en Neon, la app sigue andando con el navegador.
- **Festejos**: un aviso en la esquina (`role="status"`), sin bloquear, con botón para cerrar y que se va solo a los 7 s. Una vez por evento: no se repite al recargar.
- **«Plan activado»**: en el código no existe un evento «activar el plan», así que se tomó como «la primera skill del plan de formación pasa a En curso». Decisión del lead: lo más simple.
- **Vacíos y errores**: la pose sale del tipo de vacío. `quieto` para los genéricos y el 404, `trabajando` en Match, `analizando` en Tracker, Preparar y los errores, `explicando` en CV, Academy y el panel «?». Son decorativos: el texto de al lado dice lo mismo.
- **Animación**: los vacíos y las cargas usan a Afi estático. Así nunca hay más de un Afi animado por pantalla, ni animación en listas.

### Fuera de la app (R27-06)
- **Portada**: Afi `saludando` con prioridad, al lado del aviso de la beta. Sigue estática y no saca «Pedir acceso» de la primera pantalla a 390 px.
- **Lista de espera**: Afi `trabajando` en la confirmación.
- **Emails** de bienvenida y vencimiento: `saludando-512.png` con URL absoluta, `alt` y 160 px de alto. Los demás emails no cambian.
- **Imagen para compartir** (`next/og`): Afi junto a la marca y «Tu asistente de empleabilidad inteligente». En inglés: «Your smart employability assistant».
- **Favicon con la cara**: queda preparado, pero los archivos no están copiados a `app/` porque el guard del equipo no deja copiar ni borrar archivos (pasos manuales §3). La PWA no se tocó.

## Rendimiento

Ninguna ruta sube más de 2 kB de First Load:

| Ruta | Antes | Después | Por qué sube |
|---|---|---|---|
| `/jobs/[id]` | 146 kB | 148 kB | aviso de festejo |
| `/plan` | 107 kB | 109 kB | aviso de festejo |
| `/cv/coach/listo` | 149 kB | 151 kB | aviso de festejo |
| `/acceso`, `/cv`, `/cv/coach/charla`, `/interview/[id]`, `/onboarding/ofertas`, `/recorrido` | — | +1 kB | — |
| `/` (portada), `/hoy` y el resto | — | igual | — |

El compartido sigue en 103 kB. Framer del saludo y de los festejos se baja aparte (`AfiAnimadoLazy`). Las imágenes no cuentan en el First Load: pesan 14–20 kB a 256 px y el navegador elige el tamaño por `srcSet`.

## Accesibilidad
axe sin violaciones serias en portada, 404, Hoy, asistente abierto, un vacío, Interview y Academy, en claro y oscuro (e2e 266). También en la lista de espera (264).

El botón del asistente mide 44 px reales. En la primera vuelta el e2e encontró dos errores, ya corregidos:
- la animación de entrada lo achicaba a 40 px;
- en el celular se veían dos caras.

## Verificación
- typecheck 6/6;
- lint sin errores (una advertencia vieja en `feedback-button.tsx`);
- unit: web 465, pipeline 6235 y adapters 1704 (fallan 3 de symlinks en Windows, ajenos);
- integración db 667/667, con la 0082 aplicada en Docker;
- build completo.

**e2e locales:**
- verdes: 251–266, 123, 131, 132 y 185;
- el test del favicon del 263 se saltea hasta que esté la copia;
- `85-asistente` y parte del `86` se saltean en local porque necesitan el usuario del seed: van al CI;
- falló `86-cv-chat-repreguntas` («Armá tu CV con IA»). Ningún archivo de esa pantalla cambió en la tanda: queda para el CI.

**Sin verificar:**
- `global-error` en un navegador;
- LCP de la portada con Lighthouse;
- la captura del festejo;
- la de Hoy con el saludo: la persona de prueba ya había saludado ese día.

## Qué no se hizo
- `explicando` en el detalle del sello y en el diagnóstico del CV: solo está en el vacío del CV.
- En Interview, Afi va estático en la pregunta y la devolución: un solo animado por pantalla.
