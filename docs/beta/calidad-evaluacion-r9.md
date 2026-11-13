# Calidad de la evaluación por carrera con el modelo real (R9-6)

Estado: **sin correr con el modelo real.** El harness, la estimación y el comando están listos; la corrida es un paso de Mauro (abajo). Las tablas de resultados quedan con la estructura para completar.

## Qué mide

Para cada una de las 8 carreras de la beta, 3 avisos del golden sintético (`packages/pipeline/test/fixtures/carreras/`, **no** `evals/fixtures/golden.json`) evaluados con una persona de prueba de `apps/web/e2e/personas/`: 24 evaluaciones. Por aviso se compara el puntaje esperado (`score_esperado`) y la acción esperada (`accion_esperada`) contra lo que produce el camino de producción: prefiltro, `evaluate_job` con el modelo y `decide()`.

- **Avisos:** `nueve_mas`, `remoto_otro_pais` y `encaje_parcial` (en RR.PP. y programación, que no tienen esa categoría, `presencial_caba`). Son categorías que el prefiltro deja pasar: las que se descartan antes no llegan al modelo y ya las cubre el test determinista.
- **Personas:** abogacía → Mariana, administración → Bruno, comunicación y RR.PP. → Camila (no hay persona de RR.PP.), contabilidad → Agustina, programación → Julián, marketing → Valentina, relaciones internacionales → Inés. Del e2e se toman el puesto, el inglés y las skills (con su nivel). **Ubicación (Salta, AR), años (2) y modalidades salen del golden**, porque contra esa persona se escribieron los puntajes esperados; el texto libre del perfil de cada persona no se usa (habla de 4 a 7 años de experiencia).
- **Métricas, estrictas y laxas** (lección 13): puntaje dentro del rango esperado / a ±1 punto del rango; acción coincide (`aplicar` y `aplicar_personalizado` cuentan como `postular`). Además bloqueadores, riesgos y costo por evaluación.

## Ruteo vigente

`packages/db/seeds/model_routing.json`, fila `evaluate_job`: **Gemini 3.5 Flash** (Google) con `thinking minimal`, respaldo Claude Haiku 4.5. **No es Sonnet con respaldo Gemini**: el pedido hablaba de eso, pero el seed dice otra cosa (Sonnet 5.5 está en `draft_application_answers`, `recruiter_message`, `skill_interview` y `assistant_chat`). Si en producción `model_routing` se cambió a mano, hay que mirar esa tabla. El harness usa el modelo del seed por defecto y corre con `--model claude-sonnet-5-5` para comparar. Prompt: la versión vigente (`DEFAULT_PROMPT_VERSIONS.evaluate_job`). Sin respaldo en la corrida, para que el costo sea de un solo modelo.

## Por qué no se pudo correr desde el equipo

- `node .claude/bin/local.mjs evals run <versión>` es la única vía paga permitida y corre el golden de `evals/` con **el perfil de la persona de referencia**; no admite `--fixture`, ni otro perfil por caso. No sirve para 8 personas.
- Un script nuevo de `pnpm` no está en la lista del guard, y el worker sin `--demo` y `pnpm evals run` están bloqueados. No se esquivó nada: el harness vive en `packages/adapters/src/llm/` (no en `evals/`, para no disparar el job pago del CI) y lo corre Mauro con `!`.

## Estimación de costo (sin correr)

Tokens por evaluación medidos en evals con Gemini 3.5 Flash (`evals/src/run.ts`, `MEASURED_TOKENS_PER_CALL`): ~4 100 de entrada y ~450 de salida, unos USD 0,0099 por evaluación. Tarifas del seed.

| Modelo | Por evaluación | 24 evaluaciones |
| --- | --- | --- |
| gemini-3.5-flash (1,5 / 9 USD por Mtok) | ~USD 0,010 | **~USD 0,245** |
| claude-sonnet-5-5 (2 / 10 USD por Mtok) | ~USD 0,013 | ~USD 0,305 |

Las dos corridas juntas: ~USD 0,55. Tope duro del harness: `--max-usd` (por defecto 1, máximo 2): si el estimado lo supera no llama a nadie, y durante la corrida corta antes de la llamada que lo pasaría.

## Comando para Mauro

Primero el dry-run (no llama a ningún modelo, imprime el plan y el estimado):

```bash
pnpm --filter @job-search-os/adapters exec tsx src/llm/carreras-calidad-cli.ts
```

Después la corrida paga (pide `GEMINI_API_KEY` en el entorno local; nada se escribe en una base: las llamadas quedan en memoria y el resultado va a un JSON):

```bash
pnpm --filter @job-search-os/adapters exec tsx src/llm/carreras-calidad-cli.ts --run --max-usd 1 --out calidad-carreras-r9.json
```

Para Sonnet (necesita `ANTHROPIC_API_KEY`): agregar `--model claude-sonnet-5-5` y otro `--out`. El JSON no lleva el texto de los avisos ni de las evaluaciones, solo puntajes, acciones, bloqueadores, riesgos y costo.

## Resultados (completar con la corrida)

Esperado contra obtenido, por carrera:

| Carrera | Avisos | Puntaje en rango | Puntaje ±1 | Acción coincide | Errores | USD |
| --- | --- | --- | --- | --- | --- | --- |
| Abogacía | 3 | — | — | — | — | — |
| Administración | 3 | — | — | — | — | — |
| Comunicación | 3 | — | — | — | — | — |
| Contabilidad y finanzas | 3 | — | — | — | — | — |
| Programación | 3 | — | — | — | — | — |
| Marketing digital | 3 | — | — | — | — | — |
| Relaciones internacionales | 3 | — | — | — | — | — |
| Relaciones públicas | 3 | — | — | — | — | — |

Errores típicos (a completar): dónde el modelo sube o baja el puntaje respecto del esperado, bloqueadores que inventa o que no ve (ubicación, experiencia, disciplina) y riesgos de ubicación que no marca.

Costo real por evaluación (a completar): `costoUsd` del JSON dividido por las evaluaciones, contra los ~USD 0,010 estimados.

## Tickets que salgan (no se implementan acá)

Los hallazgos que pidan cambiar el prompt o los criterios van como tickets con el aviso, el puntaje esperado y el obtenido. Las etiquetas del golden son `assisted`, todavía sin validar por un profesional: una diferencia puede ser del golden y no del modelo.

## Límites

- Una sola corrida por modelo (temperatura 0): no mide dispersión.
- El golden y las personas son inventados; el resultado no es la calidad con avisos reales.
- Los criterios son los de `criteria.example.json`, no los de una persona real.
