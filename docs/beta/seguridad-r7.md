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

No se tocó ningún archivo de la app: no faltaba ningún header chico, así que esta rama **no toca carril rojo**.

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

| Superficie | Qué hay | Dónde |
|---|---|---|
| `/acceso` (lista de espera) | Honeypot, validación Zod y topes en la base: por IP (40 por hora, tope del evento hasta 200), ráfaga global (60 cada 10 min) y diario (600). Regla de firewall de Vercel a 60 POST por minuto por IP documentada en `docs/beta/pasos-manuales-r4.md` §2 | `apps/web/app/(public)/acceso/actions.ts:35-48`, `packages/db/rls/0006_waitlist.sql:39-41,64-75` |
| Embudo de `/acceso` | Sin tope propio, pero solo suma contadores por hora y paso (no crece por pedido) | `packages/db/rls/0016_acceso_funnel.sql:17-49` |
| Webhook de Resend | Firma Svix obligatoria con comparación en tiempo constante y tolerancia de 5 min; sin firma, 401 antes de tocar la base. Reenvíos del mismo email son idempotentes por `email_id`. Tope de rechazos por usuario y hora | `apps/web/app/api/inbound/route.ts:23-36,71`, `packages/adapters/src/inbound/svix.ts:38-45`, `handle.ts:241` |
| Login, registro, reset | Solo regla de firewall de Vercel (10 por minuto por IP, JS-108). Sin límite propio en la app. Reset: un email por cuenta cada 5 min | `apps/web/auth.ts:24-36`, `apps/web/lib/password-reset.ts:52` |
| `/api/mcp` | Token personal, 60 llamadas por minuto, 429 | `packages/db/rls/0019_mcp_tokens.sql:85`, `apps/web/app/api/mcp/route.ts:350` |
| `/api/assistant`, `/api/cv-chat` | Sesión obligatoria (401), tope de cuerpo y topes por plan sobre `llm_calls`/inicios, 429 | `apps/web/app/api/assistant/route.ts:160-168`, `apps/web/app/api/cv-chat/route.ts:108-126` |
| `/api/cv/docx`, `/api/gmail-filters` | Sesión obligatoria (401), descarga generada en memoria | `.../cv/docx/route.ts:17-18`, `.../gmail-filters/route.ts:21-22` |
| `/api/cron/*` | `Authorization: Bearer` contra `CRON_SECRET` (o `STATUS_TOKEN`) | `checkBearerSecret` en cada route |
| `/api/health` | Público, sin datos, una consulta `select 1` | `apps/web/app/api/health/route.ts:15` |
| `/api/session/ended` | Sin sesión redirige; con sesión vigente no hace nada | `apps/web/app/api/session/ended/route.ts:11` |

`/demo` es una vitrina de solo lectura sin endpoint propio de escritura.

### P2-3 · Login, registro y reset dependen de una regla manual del firewall
- Dónde: `apps/web/auth.ts:24-36` (no hay conteo de intentos fallidos).
- Escenario: si la regla del firewall (que se cargó a mano en el panel) se borra, se cambia de proyecto o no existe en un entorno nuevo, el login queda sin tope para probar contraseñas. Mitigan: costo de scrypt, comparación con hash de relleno para no distinguir email inexistente, y la contraseña mínima.
- Arreglo: contador de intentos por email normalizado y ventana en la base (función SECURITY DEFINER, como `waitlist_join`) con respuesta uniforme. Requiere migración.
- Estado: **ticket** (migración: la hace el lead, aplica Mauro). Mientras tanto, confirmar que la regla sigue activa en el panel antes del 26/11.

### P2-4 · IP del pedido de `/acceso` con respaldo falsificable fuera de Vercel
- Dónde: `apps/web/app/(public)/acceso/actions.ts:44-48`.
- Escenario: si la IP no llega por `x-vercel-forwarded-for`, se cae a `x-real-ip` y `x-forwarded-for`, que un cliente puede inventar fuera de Vercel; el tope por IP serviría de poco. En Vercel el borde los pisa, y quedan igual los topes de ráfaga y diario, que no dependen de la IP.
- Arreglo: aceptar el respaldo solo si no hay `VERCEL`, o eliminarlo. Cambio chico y verde.
- Estado: **ticket** menor, no hecho (no es parte de lo que pidió la ronda y no afecta producción).

## Lo que no se pudo verificar desde acá
- Headers reales en producción (se leyó la configuración, no se hizo una petición).
- Reglas del firewall de Vercel (viven en el panel).
- `pnpm secrets:scan`, que corre el lead.
