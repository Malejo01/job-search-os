# Informe de la tanda R9 (13/11)

Trabajaron tres teammates, cada uno en su carpeta: imagen, asistente y textos. El cuarto («pool») no se lanzó porque R9-5 quedó bloqueado. El lead revisó los cambios, los commiteó, pasó la revisión de privacidad y la de seguridad (en todos los rojos) y abrió los PR. **Ningún PR se mergeó.** Todos salen de `main` (92467dd), ninguno depende de la R8 y ninguno trae migración.

## 1. PRs, en el orden de merge sugerido

| Orden | PR | Ticket | Carril | Antes de mergear |
|---|---|---|---|---|
| 1 | [#491](https://github.com/Malejo01/job-search-os/pull/491) | R9-3 · «Pedir acceso» | verde | — |
| 2 | [#492](https://github.com/Malejo01/job-search-os/pull/492) | R9-4 · 404 sin sesión | rojo (`auth.config.ts`) | — |
| 3 | [#495](https://github.com/Malejo01/job-search-os/pull/495) | R9-2 · topes del asistente | rojo | Variables en Vercel (§4) |
| 4 | [#493](https://github.com/Malejo01/job-search-os/pull/493) | R9-1 · oferta desde una imagen | rojo (prompts) | Fila de `model_routing` en Neon (§4) |
| 5 | [#494](https://github.com/Malejo01/job-search-os/pull/494) | R9-6 · harness de calidad por carrera | rojo (`adapters/src/llm`) | — |
| 6 | este PR | cierre de la R9 | verde | Después del cierre de la R8 (#490): sale de esa rama |

**Choques previstos.** Todos son de una línea o de secciones distintas del mismo archivo:
- `packages/adapters/src/llm/index.ts`: #493 y #485.
- `packages/adapters/src/llm/spend.ts`: #493 y #495.
- `docs/OPERACION.md`: #495, #481, #485 y #488.
- `/settings/salud`: #495 suma un bloque en `page.tsx` y #482 cambia `beta-health.ts`; no tocan los mismos archivos.

**Ramas para el PR de integración** (lo arma Claude desde la nube). Primero las de la R8, en el orden de `informe-r8.md` §1. #489 (R8-0) queda afuera hasta que Mauro decida. Después:
1. `ronda/r9-3-pedir-acceso`
2. `ronda/r9-4-404-sin-sesion`
3. `ronda/r9-2-topes-asistente`
4. `ronda/r9-1-imagen`
5. `ronda/r9-6-calidad-carreras`
6. `ronda/r9-cierre` (trae también `ronda/r8-cierre`)

## 2. Cómo se probó

| Ticket | Pruebas | Revisión |
|---|---|---|
| R9-1 | Pipeline (esquema, JPEG con SOF, EOI y dimensiones, salidas inválidas). Adapters: tope de 10 solo con las llamadas `ok`, tope de 30 sobre todos los intentos («muchos fallos igual cortan»). Integración del conteo con y sin `onlyOk` (Testcontainers). Prompts y db. El e2e 129 lo corre el CI. | Seguridad: el port no perdió ninguna defensa; S3 bien. S2 abría un abuso (los fallos no sumaban ni al cupo ni al tope en USD) y se corrigió con el segundo tope. Privacidad: PASA |
| R9-2 | Tests primero en pipeline (`limits`, `metrics`, `request`, `history`, `tools`). Integración: las filas marcadoras no cambian el gasto, los cupos ni los conteos de error. e2e 132 con 20 turnos. | Seguridad: el conteo de turnos salía del historial del cliente (media, anterior al PR); se corrigió con el piso de marcadores. Las métricas se agrupan por persona y charla. Privacidad: PASA |
| R9-3 | Typecheck, eslint y prettier. 8 e2e ajustados al texto nuevo. | Privacidad: PASA. El lead corrigió dos espacios que faltaban |
| R9-4 | Test que recorre `apps/web/app`: toda ruta es pública o privada, y toda Server Action privada exige sesión. e2e 133: 404 con y sin sesión, `/hoy` va al login y un POST `next-action` a una ruta inventada también. | Seguridad: sin bypass (codificación, prefijos por segmento, `_next`, API). Se agregó la regla de `next-action`. Privacidad: PASA |
| R9-6 | 8 tests del harness con el modelo mockeado. Dry-run por defecto, tope duro de 1 USD (máximo 2). | Privacidad: PASA |

**CI: todo en verde en los 5 PR** (lint, unit, integración, build, evals y e2e). En el camino se corrigieron dos fallos de e2e:
- **129 (R9-1):** el localizador encontraba también el route-announcer de Next; se acotó a `main`.
- **109 (R9-2):** axe marcaba `scrollable-region-focusable` en la tabla nueva; quedó como región enfocable con etiqueta.

`carril` falla a propósito: ningún PR lleva `carril-verde`, porque el pedido fue sin merge.

## 3. Gasto (tope USD 5)

| Qué | USD |
|---|---|
| Job `evals` del CI en #493, el único PR que toca `packages/prompts/`. Corrió dos veces: al abrirlo y con el arreglo del e2e 129 | ~0,32 (estimado: ~0,16 por corrida; el CI no informa el monto exacto) |
| Corrida real de R9-6 | 0 (no se pudo correr; §5) |
| **Total** | **~0,32** |

## 4. Pasos manuales para Mauro

1. **Neon, fila `extract_job_from_image`** de `model_routing` (#493). El SQL con su guarda está en el cuerpo del PR y en `docs/beta/pasos-manuales-r6.md` §1: ensayo primero, después aplicar. Sin la fila, la carga desde una imagen falla cerrada en producción.
2. **Vercel:** `ASSISTANT_MAX_USD_PER_CONVERSATION=0.50` y `ASSISTANT_MAX_TURNS=20` (#495). Sin las variables rigen esos mismos valores por defecto.
3. **R9-6, corrida real** (~USD 0,55 entre el modelo vigente y la comparación con Sonnet). El comando exacto está en `docs/beta/calidad-evaluacion-r9.md`, «Comando para Mauro». Corre contra la base local y nunca contra Neon. Primero un dry-run.
4. **Alertas de Bumeran (R9-5), cuando exista el parser de R8-1:**
   - una alerta por carrera en Bumeran, con tu cuenta y en todo el país;
   - un filtro de Gmail que reenvíe cada una a `pool-<carrera>@`.
   
   Hasta entonces no sirve crearlas: los mails irían a la cola manual.
5. **Textos legales:** la imagen de una oferta viaja al proveedor del modelo (Google y, de respaldo, Anthropic) y puede traer datos de terceros. Revisar si los términos lo cubren (S6).
6. **Ruteo de `evaluate_job`:** el pedido de R9-6 decía «Sonnet, con respaldo Gemini», pero el seed dice Gemini 3.5 Flash con respaldo Haiku 4.5. Si en Neon se cambió a mano, mirar la tabla antes de la corrida.

## 5. Qué quedó afuera y por qué

- **R9-5 (pool de Bumeran): bloqueado.** Depende del parser de R8-1, que no se pudo escribir porque los agentes no pueden leer `fixtures-private/` (`informe-r8.md` §3). Lo dice el propio pedido.
- **R9-6: sin correr.** El guard bloquea el worker sin `--demo`, `pnpm evals run` y los scripts de `pnpm` nuevos. La única vía paga permitida (`node .claude/bin/local.mjs evals run`) corre el golden de `evals/`, con un solo perfil. Se armó el harness y el informe queda con las tablas vacías para completar.
- **R9-1:**
  - `cost_usd` es `null` en las llamadas fallidas de todas las tareas, así que el tope en USD no las ve. Es deuda general; en la imagen la cubre el tope de 30 intentos.
  - No hay deduplicación de imágenes iguales.
- **R9-2:**
  - El motivo del evento va en `prompt_version`, para no hacer una migración. Es reuso de una columna: si se mide más, conviene una tabla de eventos.
  - Las charlas anteriores al cambio no tienen mensajes medidos.
- **R9-3:**
  - «No pudimos anotarte» sigue en `apps/web/app/(public)/acceso/actions.ts` (carril rojo, PR aparte).
  - El prompt del asistente no se tocó (dispararía evals) y ya dice «página "Pedir acceso"».
- **R9-4:**
  - Sin sesión, un visitante puede distinguir un primer segmento privado que existe (va al login) de uno que no (404). Se acepta a cambio del 404.
  - Queda fuera del ticket verificar el rol de admin (no solo la sesión) en `settings/marca`, `settings/invitations/export` y `settings/metricas`.

## 6. Necesito de vos

1. Aplicar la fila de `model_routing` y las dos variables de Vercel (§4).
2. Correr R9-6 con `!` y decidir si los hallazgos piden cambios de prompt (serían tickets nuevos).
3. Confirmar que la ciudad y los años del golden sintético de carreras (`packages/pipeline/test/fixtures/carreras/`) no copian tu perfil real. Privacidad lo marcó como observación sin bloqueo: esos datos ya están en `main`.
4. ¿PR rojo para «No pudimos anotarte» y para el chequeo de rol de admin en las pantallas de `settings` que lo necesiten?
