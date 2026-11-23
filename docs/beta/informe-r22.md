# Informe de la tanda R22 «Operación de la beta» (23/11)

La beta se puede operar a mano sin perder nada:
- la persona avisa que pagó;
- el equipo lo confirma desde una cola;
- los vencimientos se avisan tres veces;
- el tablero muestra el uso por carrera;
- un checklist dice qué falta para abrir.

Ningún agente llamó a un modelo (USD 0), tocó Neon, Vercel, Resend o Mercado Pago, ni mergeó nada.

Base: `origin/main` en 8e3ebab. Es independiente de la R19, la S5 y la R20.

## Cómo están armadas las ramas

Una sola cadena: cada rama apunta al último commit de su ticket y contiene las anteriores. Se integran en este orden, o alcanza con la última (`ronda/r22-cierre`).

| # | Rama | Qué hace |
|---|---|---|
| 1 | `ronda/r22-03-recordatorios-vencimiento` | Avisos a 7 días, 1 día y el día; plan vencido explicado en Hoy |
| 2 | `ronda/r22-01-ya-pague` | «Ya pagué» en «Tu plan», con tope de 3 avisos pendientes |
| 3 | `ronda/r22-04-uso-por-carrera` | Uso por carrera y por semana en Métricas |
| 4 | `ronda/r22-05-checklist-apertura` | Checklist de apertura para admins |
| 5 | `ronda/r22-02-cola-de-altas` | Cola de altas, búsqueda, filtros, renovar en un clic e historial |
| 6 | `ronda/r22-cierre` | Backlog, este informe y los pasos manuales |

**Al integrar:**
- Con la R19, la S5 y la R20 choca `docs/BACKLOG.md` (bloques 35 a 38). También pueden chocar `packages/pipeline/src/index.ts`, `apps/web/app/(app)/settings/page.tsx` y `apps/web/lib/admin-routes.ts`, en líneas sueltas.
- Hay dos migraciones nuevas, 0076 y 0077. Ninguna de las otras tres tandas trae migraciones.

## Por ticket

- **R22-01 · «Ya pagué».**
  - Dónde va: el prompt pedía el botón «en `/plan`, debajo del link de Mercado Pago». `/plan` es el plan de formación y el link vive en «Tu plan» de Ajustes (`/settings#tu-plan`), así que el botón va ahí, y solo cuando se muestra el link.
  - Qué guarda: el número de operación es opcional, solo dígitos y hasta 20. Es lo único que se guarda, además del plan pedido, el estado y las fechas.
  - El tope de 3 pendientes lo impone la base, con un trigger que serializa por persona, así que dos envíos a la vez no lo pasan.
- **R22-02 · Cola de altas.**
  - La cola de avisos pendientes va arriba de `/settings/planes`:
    - «Activar 30 días» es la misma alta como pago;
    - «Rechazar» pide un motivo de hasta 200 caracteres.
  - Activar y rechazar bloquean el aviso, así que un doble clic no suma días dos veces.
  - La lista de planes suma búsqueda por email, filtros y «Renovar +30 días»: renueva siempre como pago. Se filtra en memoria, sobre la lista que la base ya trae con un tope de 200.
  - No había historial de cambios del plan: ahora está `plan_events`, sin emails, y la pantalla muestra los últimos 15. Si anotar el historial falla, el cambio de plan igual queda hecho.
- **R22-03 · Recordatorios de vencimiento.**
  - Ya existían el aviso único por email, el cron y el banner del layout. Ahora hay tres etapas, cada una una sola vez, con la misma marca `plan_notified_at` y sin migración.
  - El día de cada etapa se cuenta en hora de Argentina.
  - El aviso de la app empieza 7 días antes (antes eran 3).
  - Con el plan vencido, Hoy explica qué sigue igual y qué se pausa, con los topes reales del plan gratis.
- **R22-04 · Uso por carrera.**
  - Muestra 8 semanas de 7 métricas por carrera, en una sola consulta: una función de admin que no devuelve las celdas de menos de 3 personas.
  - La pantalla muestra «menos de 3» igual para el cero y para 1 o 2 personas.
  - De dónde sale cada métrica:
    - las charlas del coach son las conversaciones distintas de `llm_calls`;
    - los diagnósticos del CV son las llamadas `cv_review`;
    - las demás salen de sus propias tablas.
  - Límite: la actividad de IA de una cuenta borrada deja de contar.
- **R22-05 · Checklist de apertura.**
  - Tiene 8 ítems, y cada pendiente dice qué hacer y en qué documento.
  - Las variables solo se miran por presencia, nunca por valor.
  - `textos-rediseno.ts` no marca qué textos aprobó Ani. Los aprobados se anotan a mano en una lista de `lib/apertura.ts`, que hoy está vacía.

## Verificación

- **Unitarios e integración:** cada ticket con rojo y después verde, salvo R22-02 (ver abajo). El lead volvió a correr la integración de los vencimientos y la del uso por carrera con la base completa.

  | Ticket | Tests |
  |---|---|
  | R22-01 | 10 de pipeline, 10 de integración y 5 de borrado de cuenta |
  | R22-02 | 10 de pipeline y 13 de integración |
  | R22-03 | 61 de pipeline, y en adapters 12 unitarios y 9 de integración |
  | R22-04 | 17 de pipeline, 2 de roles y 10 de integración |
  | R22-05 | 12 de pipeline y 17 con `admin-routes` |
  | Multiusuario, con todas las funciones nuevas | 259 |

- **R22-02 sin rojo previo:** el test y el código se escribieron en el mismo paso, así que no hay un rojo registrado.
- **Medición:** con 200 personas × 52 semanas sembradas en el test de integración, el uso por carrera tarda una mediana de 38 ms con índices y 44 ms sin ellos.
- **e2e:** cinco specs nuevos (157, 160, 161, 164 y 165), y `/settings/apertura` sumada al 140. **En local se saltearon todos.** El guard no deja prender `PRICING_ENABLED` delante del comando, y la base local no tiene el usuario admin del seed. Cómo correrlos está en los pasos manuales.
- **Capturas:** no se hicieron. Qué mirar en el navegador:
  - «Tu plan» con el link de pago: el formulario, el aviso recibido y el tope;
  - `/settings/planes` con avisos pendientes;
  - `/hoy` con un plan vencido;
  - `/settings/metricas`, en el bloque «Uso por carrera»;
  - `/settings/apertura`.
- **Typecheck:** 0 errores en pipeline, db, adapters y web.

## Rendimiento

- `next build` antes y después de la tanda: **sin cambios de First Load** en `/hoy` (144 kB), `/settings` (150 kB), `/settings/planes` (103 kB), `/settings/metricas` (107 kB) y `/settings/salud` (107 kB). `/settings/apertura` nace en 107 kB. Todo es de servidor: ningún componente de cliente nuevo.
- **Consultas nuevas:**
  - `/hoy` suma una, chica, solo con los precios encendidos;
  - `/settings` suma una, solo con los precios encendidos;
  - `/settings/metricas` suma la del uso por carrera;
  - `/settings/apertura` hace dos en paralelo, con un tope de 3 s.

## Pendientes que salen de la tanda

- **Banner de vencimiento en `/hoy`:** queda pegado al borde porque `main` no tiene margen en esa pantalla. Arreglarlo exige tocar el layout.
- **Avisos «Ya pagué» de quien no tiene plan:** solo aparecen en la cola. El filtro «Pendientes» de la lista muestra solo a quienes ya tienen un plan.
- **Marca de aprobado en `textos-rediseno.ts`:** hoy la lista de aprobados es manual, en `lib/apertura.ts`.
- **e2e de esta tanda:** correrlos con las variables puestas (pasos manuales §6).
