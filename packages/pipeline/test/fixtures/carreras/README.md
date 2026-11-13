# Golden sintético por carrera (C8-8)

48 avisos **inventados** (8 por carrera de la beta), con empresas ficticias («Empresa A» a «Empresa H») y textos escritos para esta prueba: no copian avisos reales. Sirven para medir, **sin LLM y sin costo**, si el prefiltro y el encaje por título (`prefilter` y `assessPoolTitle`) dejan pasar lo que tiene que llegar a la persona y frenan lo que no.

- **No los usa el job pago de evals.** Viven fuera de `evals/` a propósito: el CI corre `evals` (con modelo, pago) cuando el diff toca `evals/` o `packages/prompts/`. Los usa solo el test determinista de C8-9.
- Complementan a `evals/fixtures/golden-carreras-beta.json` (R2-1), que mide títulos. Este set mide la mezcla que aparece en la beta: ubicación, nivel y títulos engañosos.

## Relaciones públicas y programación (C12, R5)

`relaciones_publicas.json` y `fullstack.json` suman 6 avisos inventados cada uno (empresas «Empresa A» a «Empresa F»), con las categorías `nueve_mas`, `remoto_ar`, `presencial_caba`, `remoto_otro_pais`, `senior_inalcanzable` y `titulo_enganoso` y la misma persona de referencia. Los corre `packages/pipeline/src/golden-carreras-r5.test.ts`, que cubre las 8 carreras de la beta.

Desde la integración de las tandas R5 a R7, con C3 adentro, `ROL_EN_MAIN` corre los avisos de RR.PP. con la clave `relaciones_publicas`, y programación con `fullstack`. `relaciones_publicas-04` cambió su título de «Community manager» a uno de RR.PP., porque por ADR-033 community manager es de marketing y el caso mide la ubicación. Estos dos archivos todavía no tienen `anchor_source: "human"`.

**R6-5:** el aviso de relaciones públicas que venía como `marketing_digital-04` pasó a `relaciones_publicas.json`. En la integración de las tandas R5 a R7 se juntó con los 6 de C12 y quedó como `relaciones_publicas-07`: marketing queda con 7 casos y RR.PP. con 7.

## La persona de referencia

Igual para las 6 carreras (`meta.persona`): vive en **Salta**, Argentina, tiene **2 años** de experiencia y acepta remoto, híbrido y presencial; lee avisos en español e inglés.

## Las 8 categorías (una por aviso, en cada carrera)

| Categoría | Ejemplo | Prefiltro | Acción esperada |
| --- | --- | --- | --- |
| `nueve_mas` | Junior, remoto para Argentina, tareas que la persona hace hoy | `must_pass` | postular (9 o más) |
| `remoto_ar` | Remoto para Argentina, nivel acorde | `must_pass` | postular |
| `presencial_salta` | Presencial en la ciudad de la persona | `must_pass` (marca de modalidad) | postular |
| `presencial_caba` | Presencial en CABA | `must_pass` (marca de ciudad distinta) | guardar |
| `remoto_otro_pais` | Remoto solo para residentes de otro país | `must_pass` (marca de residencia) | descartar |
| `senior_inalcanzable` | Director/a, Head o C-level | `must_discard` | descartar |
| `titulo_enganoso` | Nombra la carrera pero es otro trabajo («call center, se valoran estudiantes de abogacía») | `must_discard` | descartar |
| `encaje_parcial` | Área vecina o un requisito que falta | `must_pass` | guardar |

**Por qué «remoto solo para otro país» es `must_pass`:** la ubicación nunca descarta en el prefiltro (regla de `CLAUDE.md`): queda una marca de riesgo y el evaluador decide. Lo que el email no dice queda `null`.

## Campos de cada caso

- `etiquetas.prefiltro`: `must_pass` (tiene que llegar a la persona) o `must_discard` (no tiene que llegar).
- `etiquetas.flags_esperados`: marcas que debería dejar el prefiltro (informativo; el test de C8-9 las reporta).
- `etiquetas.bloqueadores_esperados`: lo que debería frenar al evaluador (`ubicacion`, `experiencia`, `disciplina`).
- `etiquetas.accion_esperada` y `score_esperado`: lo que debería decir el evaluador (rango del 0 al 10).
- `anchor_source: "assisted"`: etiqueta **propuesta** con asistencia, todavía sin validar por un profesional.

## Cómo lo valida un profesional después de la beta

1. **Quién:** una persona recibida de cada carrera (abogacía, contaduría, administración, comunicación, marketing y RR.PP., relaciones internacionales), idealmente de las que usaron la beta.
2. **Qué hace:** lee los 8 avisos de su carrera **sin mirar las etiquetas** y anota, para la persona de referencia: ¿le mostrarías este aviso? (sí/no), ¿qué harías? (postular, guardar, descartar), un puntaje del 0 al 10 y, si descartás, por qué (ubicación, experiencia, otra disciplina u otro).
3. **Comparación:** donde coincide con la etiqueta, el caso pasa a `anchor_source: "human"`. Donde no, se discute con Mauro: o se corrige la etiqueta, o se abre un ticket para el prefiltro o el evaluador.
4. **Realismo:** si algún aviso «no existe así en la vida real», se reescribe con lo que diría un aviso de verdad (sin copiar uno real).
5. **Cuándo:** después del 26/11, con los primeros 15 días de la beta, para sumar también avisos reales anonimizados (en `fixtures-private/`, nunca en el repo).

Para cambiar o sumar casos: editá el JSON de la carrera (mantené 8 por carrera y las 8 categorías) y corré `pnpm --filter @job-search-os/pipeline test`.
