# Personas sintéticas en los e2e

Cuatro personas inventadas recorren el producto de punta a punta, sin red ni LLM (el pool se siembra y el worker corre en modo demo). Entran solas al job `e2e` del CI.

| Spec | Persona | Puesto (grupo) |
|---|---|---|
| `28-persona-lucia` | Lucía, contadora en transición | Data Analyst (Tecnología) |
| `29-persona-valentina` | Valentina, SEO/SEM y redes | Marketing digital (Carreras digitales) |
| `30-persona-martin` | Martín, viene de RRHH general | Recruiter IT / RRHH tech (Carreras digitales) |
| `31-persona-tomas` | Tomás, dev junior en Node | Backend (Tecnología) |

## Qué recorre cada una

Invitación, registro, paso 1 con su puesto en el grupo correcto, Mis skills (con «Guardar y seguir», nunca «Saltear»), «Tus primeras ofertas» (3 de su puesto con la fuente, nunca la de otro puesto), evaluación demo con un score, `/jobs`, `/market` (mercado de su puesto) y `/plan` (skills del puesto o, si no alcanza, un hallazgo anotado).

Cada paso anota su duración (`tiempo`) y lo que falta o queda vacío (`hallazgo`) en `test.info().annotations`.

## Cómo sumar una persona

1. En `apps/web/e2e/personas/personas.ts`: sumar la clave a `PersonaKey` y a `PERSONA_KEYS`, y un `case` en `buildPersona` con datos inventados (email `@personas.test`, resumen que diga «ficticio», skills del `role_skills` de su puesto, 3 ofertas del puesto y 1 de otro). Las skills nuevas van en `SKILL_NAMES`.
2. Crear `apps/web/e2e/NN-persona-<clave>.spec.ts` con `definePersonaSpec("<clave>")`.
3. La lógica común vive en `apps/web/e2e/personas/flow.ts`. El mercado por puesto y el plan se calculan con `compute-market.ts` (funciones de adapters, corridas con `tsx` porque los specs son CommonJS).

Todo se borra al final del spec: usuario, invitación y filas del pool.
