# ADR-006: Criterio de deduplicación

**Status:** Accepted, punto 2 reemplazado por [ADR-013](013-dedup-exige-url-o-jd.md) (2026-09-18) · **Date:** 2026-09-09

## Context
4 alertas de LinkedIn → 12 avisos, 3 únicos. Empresa Q publicó el mismo aviso con dos títulos. Empresa F publicó dos roles distintos (no duplicados). El criterio ya resuelto en Qué Pinta Salta (Jaccard acotado) es reusable.

## Decision
Dedup determinista en dos niveles, antes del prefiltro:
1. **Clave fuerte:** `source_url` canonicalizada (sin query params de tracking) o `external_id` de la fuente → mismo job, fusionar fuentes.
2. **Clave blanda:** `empresa_normalizada` igual + similitud de título (Jaccard sobre tokens normalizados, sin stopwords ni seniority) ≥ 0.6 + ventana de 14 días → mismo job, fusionar.
3. **Texto:** si hay JD en ambos, similitud de shingles (5-gramas) ≥ 0.9 → duplicado aunque el título difiera (caso Empresa Q). Marcar `flags: ['volume_recruiting']`.
4. Misma empresa con títulos distintos y Jaccard < 0.6 → jobs distintos (caso Empresa F).

Sin LLM ni embeddings en fase 1. Embeddings (`dedup_semantic`) solo como tercer paso opcional en fase 2, con umbral calibrado sobre el golden set.

## Consequences
- Fusionar = agregar la fuente a `job_sources`, conservar la fecha más antigua, el texto más largo.
- Test obligatorio con los pares del golden set: (19,20) duplicado; (6,7) no duplicado.
