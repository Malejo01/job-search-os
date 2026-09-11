# ADR-011 · Una disciplina distinta bloquea Y hunde el score; la modalidad solo bloquea

Fecha: 2026-09-11 · Estado: aceptada · Decide: Mauro

## Contexto

Desde el prompt `evaluate_job@v1.1` el evaluador separa dos ejes: el `score` mide el encaje entre la oferta y el perfil, y la viabilidad (modalidad, años, autorización, salario, país) va en `bloqueadores_duros` y `riesgos` sin tocar el score. Con esa regla, el prompt v1.3 hizo que el modelo bloqueara bien una oferta de evaluación de IA (Empresa J, golden 11) pero le pusiera 8,5 de "encaje técnico", contra un ancla humana de 3. El MAE del subset saltó de 1,07 a 1,50.

## Decisión

Un rol de disciplina distinta no es "el mismo trabajo con un obstáculo": es OTRO trabajo. Auditar sistemas de IA con eval harnesses y red-teaming es otra profesión que construir productos con LLMs; que compartan vocabulario (RAG, agentes, evals) mide superposición de palabras, no encaje real. Por eso, cuando el paso de disciplina da distinta, el modelo bloquea Y el score queda topado en 3.

Esto no contradice la separación de ejes. Un rol presencial puede ser un 8 de match: el trabajo es el del candidato y lo que falla es DÓNDE se hace. La modalidad falla en el dónde y solo bloquea; la disciplina falla en el QUÉ y además hunde el score. El prompt lleva la explicación, no solo la regla, para que el modelo entienda por qué se tratan distinto.

Complementos de la misma tanda: la lista de bloqueadores es cerrada (modalidad, autorización, años ≥ 8, disciplina, salario bajo el piso, jornada > 40 h; 5–7 años, idioma y país son riesgos, no bloqueadores); la modalidad no afecta `location_ok`, que habla solo del país; y `decide()` limita la acción a "guardar" cuando `location_ok = "no"` aunque el score dé aplicar (`applyLocationCap`, también en el harness de evals).

## Consecuencias

- Prompt `evaluate_job@v1.3.1` en producción (MAE 0,96 con 3.5-flash, 1,00 con flash-lite, acción 79–86 %).
- El golden pliega la disciplina en el score (Empresa J 3): es la referencia, no un bug.
- Números completos y el cierre del intento con flash-lite en `docs/LLM_COSTOS.md`.
