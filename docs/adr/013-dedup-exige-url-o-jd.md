# ADR-013: Dedup — empresa + título ya no fusiona

**Status:** Accepted · **Date:** 2026-09-18 · **Reemplaza:** la clave blanda (punto 2) de ADR-006

## Context
El 2026-09-18 se cargaron a mano dos avisos distintos de la misma consultora, con URLs distintas:
"Senior Quality Engineering (Loyalty & Benefits, Manual/API Testing)" y "Senior Quality
Engineering (Biometric)". `normalizeTitle` quita seniority y paréntesis, así que los dos quedaron
en `quality engineering` (Jaccard 1) y la clave blanda de ADR-006 los fusionó. Como fusionar
conserva "el texto más largo", el JD de Biometric pisó al de Loyalty: el job quedó con título,
prefiltro y URL de uno y descripción y skills del otro. Se recuperó con un snapshot de Neon
dentro de la ventana de 6 h de historial.

Revisando producción apareció un segundo caso: "Founding Senior AI Engineer" y "Senior AI
Engineer" de la misma empresa en Get on Board (dos slugs, requisitos distintos) → Jaccard 0.67,
fusionados.

Las consultoras publican en serie "Senior X Engineer (área)" y el área vive justo en el
paréntesis que la normalización descarta. Empresa + título parecido no identifica un aviso.

## Decision
Solo se fusiona cuando algo identifica al aviso:
1. **Clave fuerte:** misma `canonical_url`, mismo `external_id` de la misma fuente, o **mismo
   `jd_hash`** (sha256 del JD sin mayúsculas ni espacios repetidos) → merge.
2. **Texto:** JD en ambos con similitud de shingles ≥ 0.9 → merge con `volume_recruiting`
   (sin cambios respecto de ADR-006; caso golden 19/20).
3. **Empresa + título** (Jaccard ≥ 0.6, 14 días) **ya no fusiona**. Si no hay JD en alguno de los
   dos, el nuevo se inserta aparte con `jobs.duplicate_of_id` apuntando al parecido y flag
   `posible_duplicado`, para revisarlo a mano. Si los dos tienen JD y el texto no llega a 0.9,
   el texto desmiente al título y no se marca nada.

`normalizeTitle` no cambia: sigue sirviendo para prefiltro y mercado; el problema era usarlo
como identidad.

## Consequences
- Perder datos por una fusión equivocada deja de ser posible por parecido de nombre. El costo
  es el inverso: el mismo aviso visto por dos canales sin JD en común (alerta de LinkedIn sin JD
  + carga desde la web de la empresa) queda como dos jobs, marcado `posible_duplicado`. Es un
  error visible y reversible; la fusión errónea no lo era.
- Test de regresión con los dos casos reales anonimizados en
  `packages/pipeline/src/dedup/fixtures/regressions.json` (originales en `fixtures-private/recovery/`).
- Pendiente fuera de este ADR: mostrar `posible_duplicado` en la UI con fusión manual (JS-025) y guardar el crudo de toda carga para que ninguna fusión pueda perder texto (JS-024).
- **Forma canónica de LinkedIn (intencional, no corregir):** `canonicalUrl` guarda `https://linkedin.com/jobs/view/<id>`, sin `www`, sin subdominio de país y sin barra final. Es a propósito: la clave fuerte por URL compara esa cadena exacta, y así un aviso visto como `www.linkedin.com/jobs/view/<id>/`, `ar.linkedin.com/...`, `/comm/jobs/view/...` o `?currentJobId=<id>` cae en el mismo job. Si se cambiara la forma, los jobs ya guardados dejarían de coincidir con los nuevos y se duplicarían (confirmado con tráfico real el 2026-09-18: Bridgenext del golden y la alerta de LinkedIn se cruzaron por URL).
