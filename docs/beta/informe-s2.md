# Informe de la tanda S2 «Endurecimiento» (18 y 19/11)

La tanda suma controles de acceso, gasto, correo entrante, logs y CI. Son 33 tickets, S2-01 a S2-34 sin S2-26. Ningún agente mergeó nada.

## Orden de merge

Ya integradas:
1. **#537** (`ronda/integracion-s2-fase-a`): S2-01 a S2-09.
2. **#538** (`ronda/integracion-s2-fase-bc`): S2-10, 15, 16, 17, 20, 25, 27, 28, 29, 30 y 32.

Faltan integrar, en este orden:

| # | Rama | Ticket | Sale de |
|---|---|---|---|
| 3 | `ronda/s2-11-recorte-campos` | S2-11 | #537 |
| 4 | `ronda/s2-12-detector-instrucciones` | S2-12 | primer commit de S2-11 |
| 5 | `ronda/s2-13-texto-externo` | S2-13 | #538 |
| 6 | `ronda/s2-18-cuotas-mcp` | S2-18 | primer commit de S2-13 |
| 7 | `ronda/s2-19-errores-mcp` | S2-19 | S2-18 |
| 8 | `ronda/s2-31-paste-jd-pendientes` | S2-31 | S2-19 |
| 9 | `ronda/s2-21-columnas-protegidas` | S2-21 | S2-10 |
| 10 | `ronda/s2-24-sesiones-cookie` | S2-24 | S2-21 |
| 11 | `ronda/s2-33-rls-atomica` | S2-33 | #538 |
| 12 | `ronda/s2-22-csp-report-only` | S2-22 | #538 |
| 13 | `ronda/s2-23-ci-endurecido` | S2-23 | #537 |
| 14 | `ronda/s2-34-docs-publicos` | S2-34 | #538 |
| 15 | `ronda/s2-cierre` | Cierre | #538 |

`ronda/s2-14-prompt-evaluacion` (S2-14) **no se integra** hasta medir el prompt: ver ADR-017.

### Choques previstos
- S2-24 y S2-27: `cv-chat/reserve.ts`, su test de integración y `api/cv-chat/route.ts`, en líneas distintas.
- S2-11 y S2-12: `worker/evaluate-job.ts`.
- S2-34 y este cierre: el final de `docs/BACKLOG.md`.

## Pasos manuales

**Base de datos.** No hay migraciones nuevas de Drizzle después de la 0069. `pnpm db:migrate` aplica los archivos nuevos de `packages/db/rls/`: 0024, 0025, 0026 y 0027.

**Antes del deploy.**
- Cada cuenta de `ADMIN_EMAILS` necesita su fila en `app_admins`.
- Las direcciones de `ADMIN_EMAILS` y `ASSISTANT_TESTER_EMAILS` que todavía no tienen cuenta se registran con una invitación atada a ese email.
- El deploy de S2-24 pide volver a iniciar sesión una vez.

**Variables opcionales.** `INBOUND_DMARC_MODE` e `INBOUND_SIZE_MODE` arrancan en `log`. `INBOUND_RAW_RETENTION_DAYS` sin definir no purga nada.

**GitHub.** Crear los Environments `evals`, `cron` y `smoke`, y activar el reporte privado de vulnerabilidades.

**Comando de una sola vez (S2-30).** Cuenta por defecto y aplica con `--apply`. Quien reenvía correo a una dirección rotada tiene que actualizar su filtro:

```
pnpm --filter @job-search-os/adapters exec tsx src/admin/rotate-inbound-cli.ts --remote
```

## Qué quedó abierto
- S2-14: prompt preparado, sin medir ni promover.
- S2-22: la política de contenido corre en modo informe. Pasar a aplicarla es una decisión aparte.
- S2-23: faltan fijar por commit dos acciones de terceros.
- S2-27: falta unificar la configuración de los topes diarios.
- S2-33: falta sumar la regla de ADR-042 a `CLAUDE.md`.
- S2-34: queda una limpieza menor de documentación.
- Los e2e los corre el CI al integrar.
