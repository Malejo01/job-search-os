# ADR-004: Ni scraping de LinkedIn ni auto-apply

**Status:** Accepted (no negociable) · **Date:** 2026-09-09

## Context
LinkedIn prohíbe automatización y suspende cuentas por patrones de navegación automatizada. La cuenta es el principal canal de contacto con reclutadores. Los productos de auto-apply concentran las quejas de calidad y targeting del mercado.

## Decision
Cero automatización de navegación en LinkedIn. Fuente primaria: alertas por email + API pública de Get on Board + carga manual. Lectura de JD: humano con Claude in Chrome, ≤ 5/día. El sistema nunca envía una postulación.

## Consequences
- El flujo "pendiente de JD" es un feature central, no un parche.
- El posicionamiento del producto es "menos postulaciones, mejores", opuesto a AIApply/LoopCV.
- Cualquier PR que agregue navegación automatizada de LinkedIn se rechaza sin revisión.
