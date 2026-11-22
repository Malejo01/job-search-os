# Informe de la tanda S4 «Cierre de la auditoría» (22/11)

Última tanda de seguridad antes de la beta. Cierra lo que quedaba de la revisión anterior en correo, gasto de IA y acceso, cambia el ruteo de modelos (Claude como principal y Gemini de respaldo) y saca el detector de instrucciones del bundle de `/onboarding`. Una revisión final de solo lectura miró el resultado y sus arreglos entraron en la misma tanda (S4-13 y S4-14). Ningún agente mergeó nada ni llamó a un modelo real.

Base: `origin/main` en 360cc92 (#548).

## Cómo están armadas las ramas

Igual que en la S3, todas las ramas forman **una sola cadena**: cada ticket es un commit (o dos) y cada rama apunta al último de los suyos, así que cada una contiene a las anteriores. Se integran en este orden, o alcanza con integrar la última (`ronda/s4-cierre`), que trae todo. Para integrar un ticket suelto se toma su commit.

| # | Rama | Qué hace |
|---|---|---|
| 1 | `ronda/s4-03-evaluacion-corte` | La evaluación inmediata se corta si el proveedor viene fallando; la sobrecarga del proveedor no suma gasto |
| 2 | `ronda/s4-07-jd-fusion-recortada` | La descripción entra recortada al tope de la evaluación, también por fusión |
| 3 | `ronda/s4-08-mensajes-de-tope` | Las reservas ocupadas avisan «mucha demanda» y no «tope diario» |
| 4 | `ronda/s4-02-correo-reintento-pendiente` | Un email que quedó a medio guardar se retoma en el reintento (migración 0073) |
| 5 | `ronda/s4-12-ruteo-principal` | Claude como principal y Gemini de respaldo; tabla de capacidades por modelo; CI de evals con la clave del principal |
| 6 | `ronda/s4-06-onboarding-liviano` | El detector de instrucciones queda solo en el servidor |
| 7 | `ronda/s4-10-ia-bajos` | Piso reservado sin el gasto de CV, tope de cuerpo en el MCP, documentación del detector |
| 8 | `ronda/s4-04-correo-almacenamiento` | Tope de correo guardado por persona, purga sin restos, índices por `raw_ref` (migración 0074), `/inbox` con ventana de 30 días |
| 9 | `ronda/s4-05-correo-cupo-esperado` | El cupo de esperados lo decide el resultado del parseo y no el remitente |
| 10 | `ronda/s4-11-acceso-bajos` | Intentos de login sin deadlocks (RLS 0043 y 0044), purga aunque falle el worker, secreto también en el hash de IP |
| 11 | `ronda/s4-09-correo-bajos` | Avisos de configuración del correo, revocar la dirección anterior (RLS 0040) y destinatarios en tiempo lineal |
| 12 | `ronda/s4-11b-aviso-secreto` | Aviso en `/settings/salud` si falta el secreto de los intentos de login |
| 13 | `ronda/s4-14-reserva-evaluacion` | Formato, tests de reservas del CV, reserva de evaluación calibrada, rutas sin tarifa que fallan cerrado, tests de descripción enorme |
| 14 | `ronda/s4-13-correo-tope-sin-perdida` | El tope por persona no corta alertas y un error no borra el email |
| 15 | `ronda/s4-cierre` | Backlog, este informe y los pasos manuales |

**A tener en cuenta al integrar:**
- Las ramas 1 a 12 son anteriores al commit de formato (rama 13): integradas solas, `prettier --check` falla en 11 archivos. Con la cadena completa, el lint queda en verde.
- La rama 5 deja tres tests de `evals/src/run.test.ts` en rojo hasta aplicar el ajuste de `pasos-manuales-s4.md` §1.8 (los agentes no tienen permiso sobre `evals/`).
- Casi todas tocan archivos del carril rojo (correo, políticas, rutas de la API, CI): las integra quien administra el proyecto.

## Migraciones y variables
- Drizzle 0073 y 0074 (índices) y RLS 0040, 0043 y 0044 (funciones). Ninguna borra datos. Detalle en `pasos-manuales-s4.md` §2.
- Variable nueva opcional: `INBOUND_MAX_BYTES_PER_USER` (200 MB). `LOGIN_ATTEMPTS_HMAC_SECRET` ya existía y ahora también se avisa en `/settings/salud`.

## Rendimiento
- Ninguna ruta empeoró ni pasó a dinámica. `/onboarding` bajó de 9,02 kB a 3,58 kB (First Load 166 → 160 kB); `/cv/coach/charla`, `/cv/perfil` y `/jobs/[id]` bajan 1 kB de First Load. Middleware y First Load compartido sin cambios.
- Las consultas nuevas (corte de circuito, barrido de provisionales, suma de bytes por persona, purga de huérfanos, conteos de `/inbox`) tienen test de `EXPLAIN` sin `Seq Scan` con miles de filas.
- Ningún render suma consultas: los avisos de `/settings/salud` se calculan con variables de entorno.

## Verificación
- Typecheck y lint en verde en la punta de la cadena.
- Unitarios en verde, salvo tres tests de enlaces simbólicos del escaneo de privacidad que ya fallaban en Windows y los de `evals` mencionados arriba.
- Integración de `adapters` y `db` con Postgres local: los fallos encontrados se corrigieron en la misma tanda (tests desactualizados por las reservas nuevas y por el recorte de la descripción).
- No corrieron e2e (quedan para el CI) ni el escaneo de secretos con Docker (paso manual, `pasos-manuales-s4.md` §4).

## Lo que queda
- Medir el ruteo nuevo con los evals antes de aplicar el SQL de producción (`pasos-manuales-s4.md` §1.3, tope USD 5).
- Revisar los textos legales por el cambio de primer destino de los datos de CV e imágenes.
- No activar `INBOUND_DMARC_MODE=enforce` sin medir antes en `log`.
