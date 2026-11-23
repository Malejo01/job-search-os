# Informe de la tanda R23 «Nivel excelente» (23/11)

Pulido de lo nuevo para que Ani lo vea:
- Interview cierra con un informe y muestra la evolución;
- Academy se busca y se recomienda según desde dónde llegás;
- cada término técnico tiene su «?»;
- un recorrido corto presenta lo nuevo;
- los vacíos y los errores llevan la marca y una salida;
- el detalle del sello y Dictar tienen movimiento.

Ningún agente llamó a un modelo ni tocó un prompt (USD 0), tocó Neon, Vercel o Resend, ni mergeó nada. Sin migraciones ni RLS: la 0058 y la 0059 quedaron libres.

## Cómo están armadas las ramas

Una sola cadena sobre `ronda/r21-cierre` (R21 sobre `main` af546e3). Cada rama apunta al último commit de su ticket y contiene las anteriores. Alcanza con la última, `ronda/r23-cierre`. **Primero se integra la R21.**

| # | Rama | Qué hace |
|---|---|---|
| 1 | `ronda/r23-03-academy-lectura` | Buscador, relacionadas, «Te puede servir», tiempo de lectura |
| 2 | `ronda/r23-01-informe-interview` | Informe al terminar la simulación, imprimible |
| 3 | `ronda/r23-05-primer-uso` | Recorrido de primer uso |
| 4 | `ronda/r23-04-ayudas-completas` | «?» en la oferta, el CV y Hoy; ficha «Logros medibles» |
| 5 | `ronda/r23-06-microinteracciones` | Detalle del sello que crece, barras, «Escuchando…» |
| 6 | `ronda/r23-07-vacios-y-errores` | Vacíos y errores con la marca |
| 7 | `ronda/r23-02-progreso-interview` | Evolución, borrar una simulación, «?» de STAR |
| 8 | `ronda/r23-08-interview-pulido` | Skeleton al enviar, vacíos y errores de Interview |
| 9 | `ronda/r23-09-presupuesto-first-load` | Interview y Academy vuelven al presupuesto |
| 10 | `ronda/r23-10-marca-primer-uso` | La marca del recorrido sale de `BRAND` |
| 11 | `ronda/r23-cierre` | Backlog, este informe y los pasos manuales |

R23-08, R23-09 y R23-10 no estaban en el prompt:
- **R23-08** junta lo de Interview que quedaba de R23-06 y R23-07. Así una sola persona tocaba `simulator.tsx`.
- **R23-09** salió de medir el build.
- **R23-10** salió de correr la suite completa.

## Por ticket

- **R23-01 · Informe de Interview.**
  - Muestra el promedio de claridad, relevancia y STAR con su palabra, la mejor respuesta y la más floja, y hasta tres consejos agrupados.
  - Trae «Practicar de nuevo con esta oferta» y se imprime limpio.
  - **Decisión:** los consejos no traen código. Cada respuesta se agrupa por el criterio donde sacó menos, con una frase fija más el consejo de la respuesta más floja del grupo. Sin IA.
- **R23-02 · Progreso en el tiempo.**
  - Tabla con la evolución de los tres puntajes en las últimas 10 simulaciones terminadas, y cuánto cambió cada uno desde la primera. No hay librería de gráficos.
  - Retomar ya existía.
  - Borrar pide confirmación dentro de la tarjeta, sin `window.confirm`. No hizo falta policy: las de las dos tablas ya permitían borrar.
  - **Decisión:** borrar **no** libera el cupo diario. El conteo une, por id, las sesiones vivas, las reservas y las llamadas que generaron las preguntas en `llm_calls`, que sobreviven al borrado. El teammate proponía lo contrario; se eligió lo conservador.
- **R23-03 · Academy.**
  - Buscador en el cliente, sin acentos ni mayúsculas.
  - Hasta 3 fichas relacionadas al pie y tiempo de lectura.
  - «Te puede servir» según `?desde=`, que se valida contra una lista cerrada (`interview`, `cv`, `avisos`, `postulacion`, `perfil`).
- **R23-04 · Ayudas.**
  - Faltaban afinidad, logros medibles y el seguimiento; las demás ya estaban.
  - Ficha nueva «Logros medibles», en borrador.
  - El «?» lleva `?desde=` a la ficha.
  - **Un «?» sin ficha aprobada no se dibuja.** Hoy las 17 fichas están en borrador, así que ninguno se ve hasta que Ani apruebe.
- **R23-05 · Primer uso.**
  - Diálogo de 4 pasos: el menú, Interview, el sello y Academy.
  - Se puede saltear y no vuelve. Atrapa el foco y lo devuelve al cerrar.
  - Se guarda en el navegador, porque la cuenta no tiene dónde guardarlo. `GuidedTour` no servía: no es modal.
  - No se abre en navegadores automatizados, salvo que el spec lo fuerce.
- **R23-06 · Microinteracciones.**
  - El `<details>` del sello se abre con transición de altura y las barras se llenan.
  - Dictar muestra «Escuchando…».
  - Con movimiento reducido, nada se mueve. El sello ya tenía su estampa.
- **R23-07 · Vacíos y errores.**
  - Un solo componente, `EstadoMarca`, y una función pura que elige mascota, ilustración o monograma. El lugar de la mascota queda listo.
  - Nuevo `app/(app)/error.tsx`: un error ya no saca a la persona del layout.
  - Inventario completo en `ops/rondas/r23-tanda/R23-07/informe.md`.
- **R23-08 · Interview pulido.**
  - Skeleton mientras se analiza la respuesta, vacío con la marca y 404 propio.
  - «Reintentar» en los errores que se pueden reintentar.
  - El tope diario dice cuándo se puede volver a empezar.

## Rendimiento (First Load, `next build`, contra la base)

| Ruta | Base | Con la tanda, antes de R23-09 | Final |
|---|---|---|---|
| `/interview/[id]` | 114 kB | 148 kB | **116 kB** (+2) |
| `/academy` | 107 kB | 111 kB | **109 kB** (+2) |
| `/interview` | 113 kB | 115 kB | **114 kB** (+1) |
| `/hoy`, `/jobs`, `/jobs/[id]`, `/applications`, `/cv` | — | sin cambio | sin cambio |

Qué pesaba:
- Framer entraba a `/interview/[id]` con Dictar y el skeleton; ahora pulsan con CSS.
- Los archivos de textos viajaban enteros al cliente.
- El informe de cierre ahora carga en un chunk aparte.

## Pruebas

- Typecheck sin errores en pipeline, adapters, db y web.
- Unitarios:
  - pipeline 6124, con el test de marca, que encontró el nombre escrito a mano (R23-10);
  - web 334;
  - adapters 1691. Fallan los 3 de symlinks de `privacy-scan`: Windows no da permiso para crearlos, son ajenos a la tanda y en el CI corren.
- Integración: adapters 25 (Interview, con borrar sin liberar el cupo).
- e2e en local, todos verdes: 180, 181, 182 y 186.
  - Cada spec falló una vez y se arregló: 180 por una espera de URL; 186 por un locator; 181 por una violación de axe real, la caja con scroll no era enfocable.
  - 183, 184, 185 y 187 usan el usuario del seed, que la base local no tiene: quedan para el CI.

## Carril

Rojo: toca `apps/web/app/(app)/interview/server.ts`, que ya estaba en la lista. Ningún archivo nuevo usa el rol de servicio, la lista de admins ni un lock global.
