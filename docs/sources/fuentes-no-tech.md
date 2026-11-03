# Fuentes para las carreras no tech de la beta: estado al 3/11 (C8-10)

Qué fuente puede traer ofertas de abogacía, contaduría, administración, comunicación, marketing y RR.PP. y relaciones internacionales, en qué estado está y qué falta. Regla de la tanda: adapters solo con **fixtures grabadas a mano y tests sin red**, cada uno detrás de su interruptor y apagado; lo que pide una key queda con el ADR propuesto; y **si no se puede armar una fixture fiel sin red, no se inventa el formato**: queda anotado.

## Resultado de C8-10: ningún adapter nuevo

| Fuente | Registro | Estado | Por qué no hay adapter nuevo |
| --- | --- | --- | --- |
| Jobicy | No | Integrada (`POOL_SOURCES`), categorías no tech mapeadas en C1-6 | Ya está |
| We Work Remotely | No | Integrada, categorías no tech mapeadas en C1-6 | Ya está |
| Remote OK | No | Integrada | Ya está; casi todo tech |
| Greenhouse / Lever / Ashby | No | Integradas por `ats_boards`; boards de staffing y empresas LATAM con puestos contables, de marketing y legales relevados en `ats-staffing-latam.md` | Falta que Mauro cargue los boards con `enabled = false` y los prenda (SQL en ese archivo) |
| Teamtailor | No | Integrada, apagada | Ya está |
| Torre | Beta privada | Adapter apagado (`INGEST_EXTRA_SOURCES`) | Necesita permiso de Torre |
| **Workable** | No (endpoint público por cuenta) | **Sin adapter** | **No se pudo grabar una respuesta real:** el contenedor de la nube no tiene salida a `workable.com` y su ficha (`workable.md`) dice que la forma de la respuesta está «a verificar». Inventar el JSON haría un adapter que pasa los tests y falla en producción. Además pide ampliar `ats_boards_provider_check` con una migración. |
| **The Muse** | Key gratuita (sin key, 500 pedidos por hora) | **Sin adapter, ADR-030 propuesto** | El ticket la pone con las que piden key; el formato de `themuse.md` sale de la documentación, no de una respuesta grabada; suma un valor al enum `source_kind` (migración). |
| **ReliefWeb** | Identificador de app (`appname`) registrado ante UN OCHA | **Sin adapter en la integración, ADR-028 propuesto, #308 aplazado** | Necesita el `appname` aprobado; el PR #308 sigue aparte y no se toca. |
| InfoJobs | Client ID y Secret | Sin adapter | Pide registro y sus términos no se pudieron leer (`infojobs.md`). Además es de España: casi todo con riesgo de ubicación para la beta. |
| Computrabajo | Alertas por email | Excepción acotada por email (ADR-024, propuesto) | No es una API: entra por la casilla del pool, no por un adapter |
| Bumeran, ZonaJobs, Indeed, LinkedIn | — | No se integran | Sus condiciones prohíben cuentas múltiples o la copia; LinkedIn, además, ADR-004 |

## Qué hacer para sumar Workable

1. Desde una máquina con salida a internet, grabar a mano la respuesta de `https://www.workable.com/api/accounts/<subdominio>` de 2 o 3 cuentas (con avisos de administración o marketing) y guardarla en `packages/adapters/src/sources/__fixtures__/workable-*.json`, sin datos personales.
2. Leer los términos completos (la cláusula sobre IA que compite con Workable).
3. Con la fixture real, el adapter es como el de Teamtailor: proveedor `workable` en `ats_boards` (migración del check), detrás de `POOL_SOURCES`, apagado.

## Qué sí ayuda ya a la beta (sin código nuevo)

- **Prender los boards relevados** en `ats-staffing-latam.md` (Mauro, SQL con `enabled = false` y después el OK): son los que más puestos de contabilidad, marketing y administración remotos para LATAM traen hoy.
- **Las alertas de Computrabajo** (ADR-024) para lo local de Salta.
- Los mapeos de categorías no tech de Jobicy y WWR ya están (C1-6).
