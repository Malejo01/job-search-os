# ADR-002: Multi-tenant en schema y auth desde la fase 1

**Status:** Accepted · **Date:** 2026-09-09

## Context
Usuario único hoy; producto para terceros después. Migrar de single a multi-tenant sobre datos en producción duplica el costo.

## Decision
`user_id` en todas las tablas de datos, RLS activo desde la primera migración, Supabase Auth con un solo usuario registrado. Sin UI de onboarding hasta fase 3. Perfil y criterios como datos (`profiles`, `evaluation_criteria`), no como constantes.

## Options Considered
- **A: Single-tenant ahora, migrar después.** Rápido hoy; migración dolorosa, riesgo de fugas de datos al agregar RLS tarde.
- **B: Multi-tenant en schema, sin onboarding (elegida).** Costo marginal: una columna y una policy por tabla.
- **C: Multi-tenant completo con onboarding.** Prematuro; distrae del core.

## Consequences
- Todo cron/webhook filtra por `user_id` explícitamente.
- Los tests de integración deben probar que un user no ve datos de otro (JS-009 incluye este test).
