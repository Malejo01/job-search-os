# ADR-001: Monorepo con pipeline puro y adapters intercambiables

**Status:** Accepted · **Date:** 2026-09-09 · **Deciders:** Mauro

## Context
El sistema debe correr hoy gratis (Vercel + Supabase) y migrar a AWS después sin reescritura, además de servir como pieza de portfolio que demuestre arquitectura testeable.

## Decision
Monorepo (pnpm workspaces + Turborepo) con `packages/pipeline` como funciones puras sin I/O y `packages/adapters` con implementaciones por entorno (pgmq/SQS, Supabase Storage/S3, Vercel Cron/EventBridge).

## Options Considered
### A: App Next.js monolítica con lógica en route handlers
Complejidad baja · Cost 0 · Migración a AWS = reescritura · Tests requieren mocks de DB.
### B: Monorepo con pipeline puro + adapters (elegida)
Complejidad media · Cost 0 · Migración = 3 adapters + `sst.config.ts` · Tests unitarios sin infraestructura.
### C: n8n para orquestación + Next.js para UI
Complejidad media · Railway ya disponible · Lógica de dedup/prefiltro difícil de testear y versionar; segundo sistema que mantener.

## Trade-off
B cuesta un día más de setup y paga en cada test y en la migración. C fue el diseño original; se descarta porque la lógica crítica (dedup, prefiltro, scoring) debe vivir en código testeado, no en nodos.

## Consequences
- Más fácil: testear, migrar, explicar en entrevista.
- Más difícil: onboarding inicial del repo; disciplina para no meter I/O en `pipeline`.
- Revisar: si n8n aporta valor para fuentes secundarias (fase 3), entra como *adapter de fuente*, no como orquestador.
