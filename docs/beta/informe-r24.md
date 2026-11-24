# Informe de la tanda R24 «Revisión completa y capturas» (23/11)

Resultado de la revisión de todo lo nuevo:
- capturas de cada pantalla para Ani, en celular y escritorio y en los dos temas;
- los e2e de lo nuevo corren en local;
- accesibilidad medida en serio;
- las rutas más pesadas bajaron entre 30 y 45 kB;
- los textos se revisaron.

Ningún agente llamó a un modelo (USD 0), tocó Neon, Vercel o Resend, ni mergeó nada. Sin migraciones, RLS ni variables nuevas.

## Cómo están armadas las ramas

Una sola cadena sobre `ronda/r23-cierre`. Alcanza con la última, `ronda/r24-cierre`. **Antes se integran la R21 y la R23.**

| # | Rama | Qué hace |
|---|---|---|
| 1 | `ronda/r24-05-revision-textos` | Puntajes con coma, «puntaje» en vez de «score», decisiones para Ani |
| 2 | `ronda/r24-04-rendimiento` | `/hoy` sin Framer; la versión adaptada del CV carga aparte |
| 3 | `ronda/r24-04b-rendimiento-jobs` | Sello, detalle y grupos de Postulaciones sin Framer |
| 4 | `ronda/r24-01-galeria` | Galería de capturas (e2e 200) |
| 5 | `ronda/r24-02-e2e-flujos-nuevos` | 183, 184, 185 y 187 sin el usuario del seed; Interview de punta a punta (201) |
| 6 | `ronda/r24-03-axe-galeria` | Accesibilidad medida en serio (e2e 210) y objetivos de 44 px |
| 7 | `ronda/r24-cierre` | Backlog, este informe y los pasos manuales |

## Capturas para Ani

- **Dónde:** `ops/capturas/r24/`, en la copia local del repo. No se versionan.
- **Qué hay:**
  - 110 capturas de página entera;
  - 28 capturas de ventana de las pantallas principales, para ver las barras fijas como se ven de verdad;
  - `indice.md`, que dice qué es cada captura y qué mirar.
- **Para regenerarlas:** `node .claude/bin/local.mjs e2e 200`, con el archivo `ops/capturas/r24/.generar` presente (o `CAPTURAS=1`).
- **Datos:** inventados, de una persona de prueba que el spec crea y después borra.
- **Lo que no se puede capturar todavía:**
  - una ficha de Academy: todas están en borrador y el estado vive en el archivo, no en la base;
  - «Ya pagué»: necesita `PRICING_ENABLED` en el servidor de e2e.

## Por ticket

- **R24-01 · Galería.**
  - Recorre la portada; Hoy, Match, la oferta con el sello abierto, una oferta lejana y Preparar; el CV con el diagnóstico; Tracker y Encaje.
  - También Interview (inicio, una pregunta, el dictado, una devolución y el informe), Academy, el plan, el recorrido de primer uso y los vacíos.
  - Todo a 390 y 1280 px, en claro y oscuro.
  - Para las capturas oculta las herramientas de desarrollo y, en las de página entera, las barras fijas.
- **R24-02 · e2e de los flujos nuevos.**
  - Los specs de la R23 que dependían del usuario del seed (183, 184, 185 y 187) ahora usan la persona de prueba y corren en local.
  - 201 recorre Interview de punta a punta por la interfaz.
  - Academy y los «?» solo se pueden probar en su estado vacío mientras no haya fichas aprobadas (propuesta en los pasos manuales).
- **R24-03 · Accesibilidad.**
  - axe en las 110 combinaciones de la galería dio **cero violaciones** de WCAG 2.0 y 2.1, A y AA.
  - El spec 210 comprueba primero que la medición es real: una violación conocida tiene que aparecer.
  - Suma `target-size` de WCAG 2.2, objetivos de 44 px como pide la marca, foco visible en los primeros Tab y que nada se mueva con «reducir movimiento».
  - Arreglado en la app:
    - los ítems de «Para hacer hoy» medían 20 px de alto;
    - «← Ofertas», «Anterior» y «Siguiente» de la oferta;
    - el link de la fuente;
    - los chips de filtros de Match medían 38 px.
- **R24-04 · Rendimiento.**
  - Framer entraba a varias rutas solo por animaciones chicas: el rebote del check, el sello, el detalle y los grupos plegables. Ahora usan la Web Animations API, con el mismo movimiento y nada con movimiento reducido.
  - La versión adaptada del CV, apagada por defecto, carga en un chunk aparte.
- **R24-05 · Textos.**
  - Puntajes con coma en el detalle de la oferta, Mercado y Postulaciones (`formatDecimal`), y «puntaje» en vez de «score».
  - No hubo tuteo ni promesas en la app.
  - 9 decisiones para Ani en [`textos-para-ani.md`](textos-para-ani.md), cada una con su captura.

## Rendimiento (First Load, `next build`)

| Ruta | Antes de la tanda | Después |
|---|---|---|
| `/applications` | 153 kB | **108 kB** |
| `/hoy` | 144 kB | **113 kB** |
| `/jobs` | 172 kB | **141 kB** |
| `/jobs/[id]` | 177 kB | **146 kB** |
| `/jobs/[id]/postular` | 112 kB | **107 kB** |
| Las demás | — | sin cambio (compartido 103 kB) |

Quedan pesadas `/cv/coach*` (174–177 kB) y `/onboarding` (160 kB): candidatas para una tanda futura.

## Pruebas

- Typecheck sin errores. Unitarios: web 337, pipeline y adapters sin cambios respecto de la R23.
- e2e en local, todos verdes:
  - 200 (galería, 24 tests);
  - 201;
  - 183, 184, 185 y 187, que ahora corren en local;
  - 154 a 156 (Preparar);
  - 180 a 182 y 186;
  - 210 (accesibilidad).
- Quedan para el CI los que usan el usuario del seed: 115 (sello, adaptado a la animación nueva), 116 y 38.

## Carril

Verde salvo lo que ya era rojo en la cadena: la R21 y la R23 son rojas. Esta tanda no suma archivos de la lista roja.
