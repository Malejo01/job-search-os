# Plan de migración a AWS

**Prerrequisito:** facturación AWS activa. Hasta entonces, todo lo de este doc se prepara pero no se ejecuta.

## Arquitectura destino

```
CloudFront + Lambda@Edge/OpenNext ← apps/web (Next.js)          [SST v3: sst.aws.Nextjs]
EventBridge Scheduler → Lambda ingest-getonboard (cada 6 hs)     [sst.aws.Cron]
API Gateway → Lambda inbound-email (webhook Resend)              [sst.aws.Function]
SQS jobs-to-evaluate → Lambda evaluate (batch 5, DLQ)            [sst.aws.Queue]
S3 raw-emails, jds, cv-uploads (privado, presigned)              [sst.aws.Bucket]
RDS Postgres 16 + pgvector (o mantener Supabase en fase 3a)      [sst.aws.Postgres]
Secrets Manager: GEMINI_API_KEY, ANTHROPIC_API_KEY, RESEND_SECRET
CloudWatch Logs + alarmas (DLQ > 0, error rate, costo LLM diario)
```

## Fases

| Fase | Qué cambia | Adapter tocado | Riesgo |
|---|---|---|---|
| 3a | Workers a Lambda + SQS; web sigue en Vercel; DB sigue en Supabase | queue, storage, cron | Bajo. Ideal para aprender Lambda/SQS/EventBridge |
| 3b | Web a AWS con SST (`sst.aws.Nextjs`) | ninguno (config) | Medio: cold starts, imágenes, env |
| 3c | DB a RDS + pgvector; auth a Cognito o mantener Supabase Auth | db, auth | Alto: migración de datos y RLS → policies en app |

Recomendación: ejecutar 3a y 3b; 3c solo si hay una razón de producto. Supabase Auth + RLS es más barato de mantener que Cognito + policies en código.

## Preparación que se hace ahora (gratis)

- [ ] Handlers con firma `(event, ctx) => result`, sin depender de `Request`/`NextResponse`.
- [ ] Adapters `queue`, `storage`, `cron` con interfaz y dos implementaciones (supabase/pgmq y aws), la de AWS testeada contra LocalStack.
- [ ] `Dockerfile` multi-stage para `apps/web`.
- [ ] `infra/sst.config.ts` escrito y validado con `sst diff` (no requiere deploy real).
- [ ] Tabla de costos estimados: Lambda + SQS + S3 dentro del free tier para el volumen de un usuario; RDS t4g.micro ~USD 12/mes fuera del free tier.

## Qué documentar cuando se ejecute

- ADR-009 con la decisión 3a/3b/3c.
- Comparativa de latencia y costo Vercel vs AWS.
- Runbook: rollback (DNS a Vercel), rotación de secrets, purga de DLQ.
