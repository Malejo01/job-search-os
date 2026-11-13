# Auditoría de seguridad pre-beta (R7-4)

Alcance: cobertura de RLS, headers de seguridad y rate limit de lo público. Solo lectura de código, más un test nuevo. Describe clases de problema, sin pasos de explotación. Los números de línea son de la rama `ronda/r7-4-auditoria-seguridad`.

Resumen: **0 P0, 0 P1, 4 P2**. Un test nuevo bloquea el hallazgo más probable a futuro (tabla nueva sin RLS).

## 1. Cobertura de RLS

Test nuevo: `packages/db/src/rls-cobertura.integration.test.ts`. Aplica todas las migraciones y recorre `pg_class` / `information_schema` / `pg_policies`. Falla si una tabla de `public` con columna `user_id`:

- no tiene RLS activo;
- no tiene FORCE;
- no tiene al menos una policy;
- tiene una policy de lectura `USING (true)` abierta a `public`, `authenticated` o `jobsearch_app`.

Las policies `*_definer_*` con `USING (true)` son solo para el dueño (lo que usan las funciones SECURITY DEFINER) y no cuentan. La lista de excepciones (`EXCEPCIONES_USER_ID`) está **vacía**: hoy toda tabla con `user_id` cumple. Corrió en Docker local: 4 de 4 en verde.

Complementa a `rls.integration.test.ts:76`, que ya exigía RLS y FORCE pero no policy.

Sin hallazgos. Notas:

- Las tablas **sin** `user_id` (`waitlist`, `acceso_funnel`, `ats_boards`) quedan con RLS y sin policies, con acceso solo por funciones SECURITY DEFINER (`0006_waitlist.sql:6-10`, `0016_acceso_funnel.sql:13-15`). El test no las mide porque no tienen `user_id`. Es el patrón documentado.
- El test usa el catálogo, no una lista a mano: no hay que acordarse de actualizarlo.

## 2. Headers

Definidos en `apps/web/next.config.ts:48-71`, para todas las rutas.

| Header | Estado |
|---|---|
| `X-Content-Type-Options: nosniff` | Está (`:53`) |
| `Referrer-Policy: strict-origin-when-cross-origin` | Está (`:54`); `no-referrer` en `/reset-password` (`:66-69`) |
| `Permissions-Policy` | Está (`:55-59`): cámara, micrófono, geolocalización, pago y USB apagados |
| `X-Frame-Options: DENY` | Está (`:60`) |
| `Content-Security-Policy` | Solo `frame-ancestors 'none'` (`:61`) |
| `Strict-Transport-Security` | No lo define la app |

No se tocó ningún archivo de la app: no faltaba ningún header chico. La rama es carril rojo solo por el test nuevo en `packages/db/src/`.

### P2-1 · Sin CSP completa
- Dónde: `apps/web/next.config.ts:61`.
- Escenario: la CSP limita solo quién puede enmarcarnos. Si algún día se cuela un script inyectado (XSS), nada limita de dónde carga ni a dónde envía datos. Hoy la mitigación es estructural: el HTML externo de emails va en `iframe` con `sandbox` vacío y el contenido de usuario se renderiza escapado por React.
- Arreglo: CSP con nonce por request (en `middleware.ts`) o hashes, primero en modo `Content-Security-Policy-Report-Only`, mirar violaciones y recién ahí hacerla estricta. Una CSP estricta nueva puede romper estilos en línea, Framer Motion y las imágenes OG, por eso no se hizo en esta ronda.
- Estado: **ticket**. Carril rojo (`next.config.ts` y `middleware.ts`).

### P2-2 · HSTS no está definido en el repo
- Escenario: Vercel agrega `Strict-Transport-Security` por defecto en los dominios que sirve, pero no está escrito ni verificado en el repo.
- Arreglo: verificar con una sola petición a producción que el header llega en el dominio propio; si no llega, agregarlo en `next.config.ts` (`max-age` de un año, sin `preload` hasta decidirlo).
- Estado: **verificación manual** de Mauro, no se hizo (no se consulta producción desde acá).

## 3. Rate limit

Por la regla de informes públicos, esta tabla dice qué controles hay, no sus umbrales exactos. Los números están en el código y en el informe privado de la ronda.

| Superficie | Qué hay |
|---|---|
| `/acceso` (lista de espera) | Honeypot, validación Zod y topes en la base (por IP, de ráfaga y diario), más una regla de firewall de Vercel |
| Embudo de `/acceso` | Sin tope propio, pero solo suma contadores por hora y paso (no crece por pedido) |
| Webhook de Resend | Firma Svix obligatoria con comparación en tiempo constante y ventana de tolerancia; sin firma, 401 antes de tocar la base. Reenvíos del mismo email son idempotentes. Tope de rechazos por usuario |
| Login, registro, reset | Regla de firewall de Vercel; el reset tiene además un tope por cuenta |
| `/api/mcp` | Token personal y tope de llamadas por minuto, 429 |
| `/api/assistant`, `/api/cv-chat` | Sesión obligatoria (401), tope de cuerpo y topes por plan, 429 |
| `/api/cv/docx`, `/api/gmail-filters` | Sesión obligatoria (401), descarga generada en memoria |
| `/api/cron/*` | `Authorization: Bearer` con secreto propio |
| `/api/health` | Público, sin datos |
| `/api/session/ended` | Sin sesión redirige; con sesión vigente no hace nada |

`/demo` es una vitrina de solo lectura sin endpoint propio de escritura.

### P2-3 · Tope de intentos de login propio de la app
- Clase: endurecimiento de autenticación (defensa en profundidad).
- Estado: **ticket**, requiere migración. El detalle queda fuera del repo público.

### P2-4 · Origen de la IP en el tope por IP de `/acceso`
- Clase: endurecimiento menor de un control que ya existe; no afecta producción en Vercel.
- Estado: **ticket** menor, verde. El detalle queda fuera del repo público.

## Lo que no se pudo verificar desde acá
- Headers reales en producción (se leyó la configuración, no se hizo una petición).
- Reglas del firewall de Vercel (viven en el panel).
- `pnpm secrets:scan`, que corre el lead.
