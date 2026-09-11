# ADR-007: AWS diferido, portabilidad desde el día 1

**Status:** Accepted · **Date:** 2026-09-09

## Context
AWS, Docker, CI/CD y testing son los gaps más frecuentes en las ofertas relevantes (12, 7, 8, 7 menciones). No hay facturación AWS disponible por ahora.

## Decision
Producción en Vercel + Supabase. Se hace ahora todo lo que es gratis y cubre gaps: Docker Compose local, GitHub Actions con tests y evals, migraciones versionadas, tabla `llm_calls`. Los handlers del pipeline se escriben con firma compatible con Lambda. Cuando haya facturación: SST v3 (OpenNext + Lambda + EventBridge + SQS + S3), documentado como ADR-009 y caso de portfolio.

## Options Considered
- **A: Todo en AWS desde el inicio.** Sin facturación, imposible.
- **B: LocalStack para simular AWS ahora.** Sirve para S3/SQS en tests; no sustituye un deploy real. Se incluye en `infra/` para tests de adapters, no como producción.
- **C: Vercel + Supabase con portabilidad (elegida).**

## Consequences
- Ver docs/AWS_MIGRATION_PLAN.md.
- El CV puede listar Docker, CI/CD, testing y evals con evidencia inmediata; AWS cuando se ejecute la migración.
