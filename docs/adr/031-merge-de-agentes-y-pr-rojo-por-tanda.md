# ADR-031: los agentes mergean el carril verde y lo rojo va en un PR único por tanda

**Status:** Accepted · **Date:** 2026-11-06 · Complementa `docs/CARRIL_VERDE.md`. Reemplaza, para el carril verde, la frase «Sin merge automático; Mauro revisa» de la regla 5 de `CLAUDE.md`.

## Context

- Hasta la tanda R4 cada PR esperaba a que Mauro lo revisara y lo mergeara. Con tandas de 15 o más tickets eso convierte a Mauro en el cuello de botella y deja PRs listos esperando días, con conflictos que crecen.
- El carril verde ya existe (`docs/CARRIL_VERDE.md`): un PR que no toca ninguna ruta de `.github/carril-rojo.txt`, con el CI en verde y la etiqueta `carril-verde`, se mergea solo cuando pasan el check `carril` (que corre desde `main`, `pull_request_target`) y el CI. El smoke post-deploy y el rollback ya están documentados.
- Lo que toca base, autenticación, prompts, evals, workflows, dependencias o legales (`.github/carril-rojo.txt`) necesita los ojos de Mauro: un error ahí cuesta datos, plata o confianza.

## Decision

1. **Carril verde: lo mergean los agentes, con revisión de otro agente.** Cada PR verde de una tanda pasa por un implementador, por una revisión independiente (otro agente, distinto del que implementó, con veredicto PASA/NO PASA y evidencia) y por la revisión de privacidad. Con las tres en orden y el CI en verde, el lead activa el auto-merge con las tres formas exactas de la Puerta 2b (`gh pr ready`, `gh pr edit --add-label carril-verde`, `gh pr merge --auto --squash`). GitHub mergea cuando pasan `carril` y el CI.
2. **Carril rojo: un PR único por tanda que mergea Mauro.** Todo lo que toca una ruta roja se commitea en una rama acumuladora de la tanda (`ronda/<tanda>-carril-rojo`) y va en un solo PR. Su cuerpo trae un resumen, una tabla por ticket (qué cambia, archivos rojos, riesgo, cómo se probó), el SQL a aplicar en Neon antes del merge y qué mirar primero. Mauro lo revisa y lo mergea; los agentes nunca lo mergean.
3. **Excepciones:** un ticket rojo que Mauro quiera revisar suelto va en su propio PR rojo (por ejemplo, las ilustraciones de R4-01). Un PR verde que dependa de un rojo no se mergea antes que el rojo, o se documenta el orden en los dos PR.
4. **El auto-merge se frena** si el smoke falla o no termina, si Mauro dejó una pausa, durante un ensayo o una demo, o si el PR depende de otro que no está en `main`.

## Cómo pausar

Lo que vale es destildar Settings → General → «Allow auto-merge» (GitHub desactiva el auto-merge de los PR que lo tenían). Señal adicional: la variable `AUTO_MERGE_PAUSED=true`. Freno puntual: `gh pr merge <n> --disable-auto`. Detalle y cómo reanudar en `docs/CARRIL_VERDE.md`, «Pausar».

## Consequences

- Los PR verdes llegan a producción el mismo día, con revisión de otro agente y smoke post-deploy; Mauro lee el resumen en vez de cada diff.
- Mauro revisa una sola vez por tanda lo que importa (rojo), con todo el contexto junto. Un PR rojo grande es más difícil de revisar: por eso el cuerpo ordena qué mirar primero, y un ticket delicado puede ir suelto.
- La rama acumuladora sale de `main` al principio de la tanda y no se rebasea ni se mezcla con `main` desde la sesión (las reglas de git del equipo no lo permiten): GitHub prueba el PR contra `main` mezclado, y si aparecen conflictos se resuelven al final con Mauro.
- Si un merge verde rompe producción, el smoke lo detecta y el rollback está en `docs/CARRIL_VERDE.md`; la pausa frena los siguientes.
