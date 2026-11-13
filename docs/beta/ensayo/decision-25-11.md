# Decisión del 25/11: ¿se abre la beta el jueves 26?

Quién decide: Mauro, con Ani. Esto reemplaza la decisión suelta del final de `docs/beta/ensayo.md` con criterios medibles; ese doc sigue siendo la fuente del recorrido.

Los números se llenan el 24/11 a la noche y se revisan el 25/11 a la mañana. Cada uno lleva fecha y de dónde sale.

## Criterios

Hay dos tipos. Los **imprescindibles** tienen que cumplirse todos; si falla uno, la respuesta es «se posterga» (o «se abre sin esa carrera» si el problema es de una sola). Los **de calidad** se miran juntos.

### Imprescindibles

| # | Criterio | Umbral | De dónde sale | Valor (llenar) |
| --- | --- | --- | --- | --- |
| 1 | P0 abiertos | **0** | Issues con P0 sin cerrar (`feedback-y-triage.md`) | |
| 2 | `/settings/salud` | Todo en verde el 25/11 a la mañana | `/settings/salud` | |
| 3 | Cuentas, cobro y legal | 0 problemas (un P0 de estas áreas posterga siempre) | Issues P0 | |
| 4 | Gasto de IA contra el tope | **Menos del 70 %** de `LLM_DAILY_CAP_USD` en el peor día del ensayo, sin que el tope haya frenado evaluaciones | `pnpm llm:spend --days 2` | |

### De calidad

| # | Criterio | Umbral | De dónde sale | Valor (llenar) |
| --- | --- | --- | --- | --- |
| 5 | Tasa de error | **Menos del 2 %** de las respuestas de la app con error 5xx en las 48 h del ensayo | Vercel Logs (filtro *Error* sobre el total de requests de *Usage*) | |
| 6 | P1 abiertos | **3 o menos**, ninguno que impida terminar el guion | Issues P1 | |
| 7 | Testers que completaron el guion | **Al menos el 70 %** de quienes empezaron los 8 pasos de `guion-por-carrera.md`; y al menos 1 tester por carrera que llegó al paso 5 | Planillas de `ensayo-testers.md` §5 | |
| 8 | Carreras cubiertas | Las 8 con al menos 1 tester que terminó el onboarding y vio ofertas | Planillas y `/settings/metricas` | |
| 9 | 👍 sobre evaluaciones | **60 % o más** de 👍 sobre el total de votos (con al menos 10 votos) | `/settings/metricas` | |

## Cómo se decide

| Resultado | Decisión |
| --- | --- |
| Los 4 imprescindibles cumplidos y al menos 4 de los 5 de calidad | **Se abre el 26/11** |
| Imprescindibles cumplidos, pero una carrera con P0 propio o sin pool de ofertas | **Se abre sin esa carrera**: se avisa a quienes la eligieron |
| Falla el 1, el 2, el 3 o el 4 | **Se posterga**: se fija una fecha nueva y se avisa por los canales de la lista de espera |
| Hay duda | Se decide Mauro, y se anota el motivo en este archivo |

## Después de decidir

- Anotar acá: fecha, decisión, motivo y quién decidió.
- Si se abre: seguir `docs/beta/runbook-apertura.md` §2 (activar planes, qué mirar el día).
- Si se abre sin una carrera o se posterga: pasar los P0 y P1 abiertos a la lista de pendientes con responsable y fecha.

| Fecha | Decisión | Motivo | Quién |
| --- | --- | --- | --- |
| | | | |

## Lo que no se mide acá

La calidad percibida de cada evaluación (si el puntaje «tiene sentido») es una opinión de cada tester: va en la planilla, no en esta tabla. Un patrón repetido se vuelve un P1 y se cuenta en el criterio 6.
