# ADR-003: Ingesta de emails por forwarding a inbox propio, no por Gmail OAuth

**Status:** Accepted · **Date:** 2026-09-09

## Context
El diseño original leía alertas con Gmail API. Para terceros, `gmail.readonly` es un scope restringido: publicar la app exige verificación y auditoría de seguridad de Google, o quedar en modo test con tope de usuarios. Además ata el producto a Gmail.

## Decision
Cada usuario recibe `u_<id>@ingest.<dominio>`. Crea un filtro en su correo que reenvía las alertas. Un proveedor de email inbound (Resend o Postmark) convierte cada email en un webhook `POST /api/inbound` con HTML y metadatos. El parser por remitente (`linkedin`, `getonboard`, `generic`) produce `RawJob[]`.

## Options Considered
| | A: Gmail API OAuth | B: IMAP con app password | C: Forwarding + inbound webhook (elegida) |
|---|---|---|---|
| Complejidad | Media | Media | Baja |
| Terceros | Bloqueado por verificación | Requiere que el usuario entregue credenciales | Cualquier proveedor, sin credenciales |
| Costo | 0 | 0 | 0 en tiers gratuitos de inbound |
| Riesgo | Scope restringido | Manejo de contraseñas | Dependencia de un proveedor de inbound |

## Consequences
- Más fácil: onboarding de terceros, seguridad (no guardamos credenciales de correo).
- Más difícil: el usuario configura un filtro (una vez). Documentar con capturas.
- Para Mauro: usar el mismo mecanismo desde el día 1; Gmail API queda descartada.
