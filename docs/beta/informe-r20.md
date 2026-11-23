# Informe de la tanda R20 «CV que suma puntos» (22/11)

El diagnóstico del CV completa sus dos ítems pendientes por código: las palabras clave de la carrera y los logros medibles. «Preparar mi postulación» compara el CV con la oferta y permite descargarlo ordenado para ella. Además hay una versión adaptada con IA, apagada por defecto, que se descarta entera si inventa cualquier dato.

Ningún agente llamó a un modelo real (todo con `LLM_DEMO=1`, USD 0), tocó Neon o Vercel, ni mergeó nada.

Base: `origin/main` en 8e3ebab. Es independiente de la R19 y de la S5.

## Cómo están armadas las ramas

Una sola cadena: cada rama apunta al último commit de su ticket y contiene las anteriores. Se integran en este orden, o alcanza con la última (`ronda/r20-cierre-v2`).

| # | Rama | Qué hace |
|---|---|---|
| 1 | `ronda/r20-03-cv-para-oferta` | «Tu CV frente a esta oferta»: qué pide el aviso, qué falta y en qué orden conviene poner las viñetas |
| 2 | `ronda/r20-01-palabras-clave` | Palabras clave de la carrera en el diagnóstico, contra el mercado del puesto |
| 3 | `ronda/r20-05-descargar-cv-oferta` | Descargar el CV para esta oferta (`.docx`), con un arreglo de tipos de la rama 1 |
| 4 | `ronda/r20-02-logros-medibles` | Logros medibles en el diagnóstico |
| 5 | `ronda/r20-06-cv-texto-largo` | El armado del CV no se demora con texto largo sin espacios |
| 6 | `ronda/r20-04-version-adaptada` | Versión adaptada con IA: prompt `cv_tailor` v1, verificación, interruptor, cupo, modelo simulado |
| 7 | `ronda/r20-04b-montaje-version-adaptada` | La versión adaptada se pide y se descarga desde la oferta |
| 8 | `ronda/r20-cierre-v2` | Backlog, este informe y los pasos manuales |

**Al integrar:**
- La rama 1 sola no pasa el typecheck de web por un export duplicado. El arreglo está en la 3.
- Con la R19 y la S5 chocan `docs/BACKLOG.md` (bloques 35, 36 y 37) y, puede ser, `packages/pipeline/src/index.ts` y `packages/adapters/src/index.ts`.
- La rama 6 suma un prompt en `packages/prompts/`: en un PR, eso dispara los evals pagos del CI.

## Por ticket
- **R20-01 · Palabras clave.**
  - Compara el CV con las 15 skills más pedidas del puesto principal.
  - El puntaje sale de la proporción que cubre, con un piso para los mercados chicos.
  - Con menos de 20 avisos en el puesto dice «Sin datos suficientes», sin puntaje.
  - El consejo nombra las 5 que faltan, en orden de demanda.
  - El mercado se lee una vez por pantalla y queda en caché 30 minutos por puesto.
- **R20-02 · Logros medibles.**
  - Cuentan como resultado: porcentajes, montos, tiempos, cantidades, «de X a Y» y multiplicadores.
  - No cuentan: un año suelto, un período, una versión ni «3 años».
  - La meta es la mitad de las viñetas, entre 3 y 6.
  - El consejo cita tal cual una viñeta propia sin resultado y da una plantilla, sin reescribirla.
  - Límite conocido: un horario («de 9 a 18») cuenta como «de X a Y».
- **R20-03 · CV para esta oferta.**
  - Cruza las skills del aviso con las del CV y ordena las viñetas, sin reescribirlas.
  - El botón «Afinar mi CV para esta oferta» lleva al coach con la oferta en la URL. El coach todavía no la usa como contexto: hacerlo exige tocar su prompt.
- **R20-05 · Descarga.**
  - El `.docx` se arma en memoria y no se guarda.
  - El nombre del archivo queda saneado, con `CV.docx` de respaldo.
  - Las viñetas se reordenan solo dentro de cada entrada.
- **R20-04 · Versión adaptada con IA.**
  - El modelo no escribe el CV. Devuelve viñetas y skills reordenadas por entrada. Nombre, contacto, cargos, empresas y fechas salen siempre del CV confirmado.
  - La verificación por código descarta la versión entera ante cualquier dato que no estaba en el CV, y la descarga vuelve a verificarla.
  - `CV_TAILOR=off|testers|all`, `off` por defecto y ante cualquier otro valor.
  - Tope de 3 por persona por día, con reserva de cupo.
- **R20-06 · Texto largo.**
  - La búsqueda de emails al limpiar el CV tardaba un tiempo cuadrático con un tramo largo sin arroba. Ahora es lineal, con el mismo resultado.
  - Lo encontró el teammate de R20-04 mientras probaba.

## Verificación
- **Unitarios e integración:** cada ticket con rojo y después verde; el lead volvió a correr los de cada uno.

  | Ticket | Tests |
  |---|---|
  | R20-01 | 31 |
  | R20-02 | 61 |
  | R20-03 | 7 |
  | R20-05 | 16 |
  | R20-06 | 83 de `cv-out` |
  | R20-04 | 39 de pipeline, 6 de adapters y 11 de integración |

- **e2e locales:**
  - 154: 2 de 2.
  - 155: 3 de 3, después de corregir el spec. Sin sesión, el middleware redirige con 307 antes de llegar a la ruta.
  - 156: 5 de 5, con el modelo simulado: verificación, descarte de un dato inventado, descarga, propuesta basura y tope diario.
- **Typecheck:** 0 errores en pipeline, adapters y web.
- **Capturas:** no se hicieron. Qué mirar en el navegador:
  - `/cv`: los ítems «Palabras clave de tu carrera» y «Logros medibles»;
  - `/jobs/<id>/postular`: con y sin CV, a 390 px y en oscuro.

## Rendimiento
- **`/cv`:** sin cambios en el tamaño (110 kB de First Load). Suma la lectura del mercado del puesto (en caché 30 minutos por puesto) y una consulta chica del puesto principal.
- **`/jobs/[id]/postular`:** sube de 107 a 112 kB de First Load (**+5 kB, por encima del presupuesto de 2 kB**). Viene de los componentes de cliente nuevos: el panel de la versión adaptada y el formulario de descarga. Cargarlo con `next/dynamic` no lo achicó. Queda como pendiente: medir qué módulo pesa y separarlo.
- **Páginas públicas:** siguen estáticas.
- **Sin cambios:** middleware (88,6 kB) y First Load compartido (103 kB).

## Pendientes que salen de la tanda
- Bajar los 5 kB que suma `/jobs/[id]/postular`.
- Que el coach use la oferta como contexto (`?oferta=<id>`). Exige tocar su prompt, con evals.
- La ficha de Academy «Logros medibles», que todavía no existe.
- `evals/src/run.test.ts` tiene 3 tests que fallan y ya fallaban antes de la tanda: cuentan 40 casos donde esperan 41, y 120 donde esperan 123.
