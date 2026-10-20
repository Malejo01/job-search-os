<!-- mover a DEPLOY.md cuando se mergee el #95 -->

# Vitrina pública: variables de entorno

La vitrina (`/`, `/mercado`, `/ofertas`, `/acceso`) son páginas ISR (`revalidate = 3600`). Lo que
leen del entorno queda fijo en el HTML hasta la próxima regeneración (hasta una hora, o el
siguiente deploy). Eso está bien: no hace falta forzar nada al cambiar una variable.

## Variables

| Variable | Para qué sirve | Si falta |
|---|---|---|
| `CONTACT_EMAIL` | Email de contacto que se muestra en `/acceso` (pedir el borrado de los datos de la lista de espera) y en el pie de `/ofertas` (retirar un aviso). Ejemplo: `contacto@example.com`. No va en el repo, que es público. | La línea de contacto no se muestra: `/acceso` queda sin la frase "Para borrar tus datos, escribinos…" y `/ofertas` sin el pie "¿Publicaste uno de estos avisos…?". Un valor sin formato de email se trata como si faltara. |
| `SITE_URL` | URL pública del sitio para metadata, sitemap y robots. Gana sobre el dominio que da Vercel. | Se usa `VERCEL_PROJECT_PRODUCTION_URL`; sin ninguna de las dos (local, CI), `http://localhost:3000`. El sitemap y los canónicos saldrían con un dominio equivocado. |
| `WAITLIST_PEPPER` | Sal secreta del HMAC con el que se hashea la IP en el límite de la lista de espera. | Se usa `AUTH_SECRET`; si tampoco está, todas las IP caen en un mismo bucket y el límite por IP se aplica en conjunto (se loguea un aviso). |
| `DATABASE_URL_APP` | Conexión con el rol `jobsearch_app` (RLS) que usa la app para leer el pool y escribir la lista de espera. | Se usa `DATABASE_URL`. Sin ninguna (por ejemplo el build del CI) las páginas muestran "Datos en preparación." en lugar de cifras y ofertas. |

## Recomendación

Cargarlas en Vercel para **todos los entornos, build incluido** (Production, Preview y
Development, y sin limitar la variable a runtime). Así la vitrina sale del deploy con los datos y
el contacto ya puestos, sin esperar a la primera regeneración. Para lo de la base (qué rol y qué
URL usar en el build), ver el PR #111.

## Cómo comprobar

- Sin `CONTACT_EMAIL`, "escribinos" no aparece ni en `/acceso` ni en `/ofertas` (lo cubre
  `apps/web/e2e/44-vitrina.spec.ts`).
- Con la variable, el enlace es `mailto:` con el asunto codificado; la lógica está en
  `packages/pipeline/src/pool/showcase/contact.ts` y se prueba ahí.
- Las rutas públicas deben seguir como `○` (estáticas) en `node .claude/bin/local.mjs build-sin-base`.
