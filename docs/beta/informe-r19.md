# Informe de la tanda R19 «Ofertas del pool para todas las carreras» (22/11)

La tanda construye el camino para que las alertas de Computrabajo, reenviadas desde el Gmail de personas conocidas, carguen avisos al pool de todas las carreras. El lector queda **apagado** hasta validarlo con el primer email real (ADR-024 §9, ADR-043). Suma también:
- un comando para reprocesar la cola;
- avisos y métricas para el admin;
- el filtro de Gmail con su guía;
- un arreglo del asistente en el celular.

Ningún agente llamó a un modelo (USD 0), tocó Neon o Vercel, ni mergeó nada.

Base: `origin/main` en 8e3ebab, con la S4 (#550) y la R17 (#551) ya mergeadas.

## Cómo están armadas las ramas

Hay una sola cadena: cada rama apunta al último commit de su ticket y contiene las anteriores. Se integran en este orden, o alcanza con la última (`ronda/r19-cierre`).

| # | Rama | Qué hace |
|---|---|---|
| 1 | `ronda/r19-03-vencimiento-salud` | `/settings/salud`: cuántos emails del pool vencen en 7 días sin leer |
| 2 | `ronda/r19-06-asistente-celular` | El asistente no tapa contenido en el celular |
| 3 | `ronda/r19-04-cobertura-pool` | `/settings/metricas`: casillas del pool, estado del lector y avisos por carrera |
| 4 | `ronda/r19-01-lector-computrabajo` | Lector de alertas de Computrabajo, apagado, con atribución «vía Computrabajo» (ADR-043) |
| 5 | `ronda/r19-05-filtros-gmail` | Filtro de Gmail por carrera y guía para amigos |
| 6 | `ronda/r19-02-reprocesar-cola` | `pnpm pool:reprocess` |
| 7 | `ronda/r19-cierre` | Backlog, este informe y los pasos manuales |

**A tener en cuenta al integrar:**
- La rama 3 ya muestra el enlace a la ruta de descarga de filtros, que recién llega en la rama 5. Compila igual, pero el enlace da 404 hasta la 5.
- Varias tocan archivos del carril rojo: `inbound/handle.ts`, `settings/**` y `package.json`.

## Por ticket
- **R19-01 · Lector.**
  - Parser `pool_computrabajo_alerts`. Reusa la lectura de tarjetas de `computrabajo.ts`, extraída sin cambiar su comportamiento.
  - Descarta todos los parámetros del tracker.
  - Interruptor `POOL_COMPUTRABAJO_READER`: solo `"1"` lo prende.
  - Estructura desconocida: `{ ok: false }` y el email va a la cola manual.
  - Si algunos avisos no se pudieron cargar, el email sigue en la cola con el motivo.
  - El esqueleto va al log con conteos y una huella, sin texto ni links. No usa `skeleton.ts`, porque ese depende de patrones privados.
  - Se sumó `computrabajo_alerts` a `SourceKind` y a la atribución.
  - ADR **043**: el prompt decía 040, pero del 040 al 042 ya estaban usados.
- **R19-02 · Reprocesar.**
  - Idempotente, por lotes (20 por defecto, hasta 200), con `--dry-run`.
  - `--include-failed` reintenta los emails que ya fallaron.
  - Por defecto corre en local; `--remote` pide confirmar con «si».
  - Con el lector apagado no escribe nada.
- **R19-03 · Vencimiento.**
  - Una subconsulta `count` dentro de la consulta única de salud.
  - «Sin leer» quiere decir `seen_at` y `dismissed_at` nulos.
  - Incluye los emails con la purga atrasada.
  - Umbrales: amarillo de 1 a 19 y rojo desde 20.
- **R19-04 · Cobertura.**
  - `inbound_emails` no guarda el destinatario. Por eso la fecha del último email va **por carrera** (último aviso que entró por email) y no por casilla, más una fecha global de la cola. Por casilla habría hecho falta una migración.
  - Sin remitentes ni textos.
- **R19-05 · Filtros.**
  - Un XML por carrera, con un solo filtro: `from:computrabajo.com` → `pool-<carrera>@<INGEST_DOMAIN>`. Nunca reenvía todo.
  - Es un archivo por persona porque todas las alertas salen del mismo remitente.
  - La ruta es solo para admin y falla cerrado sin `INGEST_DOMAIN`.
- **R19-06 · Asistente.**
  - El aviso sale una vez por sesión (sessionStorage) y se cierra a los 6 s.
  - A menos de 640 px el botón es un círculo de 44 px solo con ícono.
  - El layout suma un separador en el celular.
  - El componente real es `components/assistant-mascot.tsx`. `(app)/assistant-button.tsx` no se usa en ningún lado: queda como deuda.

## Verificación
- **Unitarios e integración:** en verde los de cada ticket, y el lead los volvió a correr.

  | Ticket | Unitarios | Integración |
  |---|---|---|
  | R19-01 | 59 + 23 | 33 |
  | R19-02 | 3 | 8 |
  | R19-03 | 12 | 1 |
  | R19-04 | — | 8 |
  | R19-05 | 13 | — |
  | R19-06 | 5 | — |

- **Typecheck:** pipeline, adapters y web en 0 errores.
- **Lint:** eslint y prettier limpios en los archivos tocados.
- **Tests primero:** rojo antes de implementar en todo, salvo R19-02, que escribió los tests junto con el código.
- **e2e locales:**
  - 123 (asistente): 9 de 9. Hubo un arreglo en el camino: el aviso se gastaba con el doble montaje del modo estricto de React.
  - 149 (cobertura): no corre en local porque la base no tiene el usuario del seed. Queda para el CI.
- **Capturas:** no se hicieron. Qué mirar:
  - a 390 px: `/hoy`, `/interview` (el contador), `/academy` y una oferta, bajando hasta el final;
  - `/settings/metricas`: la tarjeta «Casillas del pool», con 8 carreras, lector «Apagado» y los enlaces «Filtro»;
  - `/settings/salud`: la última fila, «Emails del pool por vencer».

## Rendimiento
Ninguna ruta cambió de tamaño: `/hoy` 144 kB, `/interview` 113 kB, `/academy` 107 kB y `/jobs/[id]` 176 kB de First Load. Middleware y First Load compartido, iguales.

Consultas nuevas:
- salud: una subconsulta, dentro de la consulta que ya existía;
- métricas: dos agregados, solo para admin.

Las páginas públicas siguen estáticas.

## Migraciones y variables
- Sin migraciones.
- Variable nueva, opcional: `POOL_COMPUTRABAJO_READER`, apagada. Ver `pasos-manuales-r19.md`.

## Pendientes que salen de la tanda
- Validar el lector con el primer email real antes de prenderlo.
- «vía <fuente>» para las fuentes `other` (Jooble y Careerjet).
- Que `poolGmailFilterXml` devuelva `Result` en vez de tirar una excepción (deuda menor).
- Borrar `(app)/assistant-button.tsx`, que no se usa.
- Guardar el destinatario de los emails del pool, si hace falta la fecha por casilla. Lleva migración.
