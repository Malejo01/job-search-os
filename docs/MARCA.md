# Marca: dónde está y cómo se cambia (C-15)

El nombre, los colores, el ícono, la URL y el remitente salen de pocos lugares. Cambiar de marca es un PR chico y un par de variables.

## Lo que sale de un solo lugar
| Qué | Dónde | Cómo se cambia |
|---|---|---|
| Nombre visible: títulos, header, emails y filtros de Gmail | `packages/pipeline/src/brand.ts` (`BRAND.name`; `PRODUCT_NAME` sale de ahí) | Una línea |
| `User-Agent` hacia las fuentes públicas del pool | `SOURCE_USER_AGENT_BASE` (`packages/adapters/src/sources/user-agent.ts`): `BRAND.name` sin espacios + `/1.0` | Sale solo de `BRAND.name` |
| Repositorio público («Cómo está hecho») | `BRAND.repoUrl` | Una línea |
| Colores de marca | `apps/web/app/globals.css`: `--jso-brand`, `--jso-brand-hover` y `--jso-brand-contrast`, en `:root` (claro) y en `.dark` (oscuro). Los demás tokens están en `docs/ux/tokens.md` | Seis líneas |
| Ícono de la pestaña | `apps/web/app/icon.svg` (provisorio, sin letras) | Reemplazar el archivo |
| URL pública (metadata, sitemap, robots, links de email) | Variable `SITE_URL` (`apps/web/lib/site-url.ts`) | Vercel, Puerta 3 |
| Remitente de los emails | Variable `EMAIL_FROM`; sin ella, `BRAND.name` con el sandbox de Resend | Vercel, Puerta 3 |
| Dominio del email entrante | Variables de ingesta (`docs/DEPLOY.md`) | Vercel y DNS, Puerta 3 |

**Guarda (C6-2).** `packages/pipeline/src/brand.test.ts` recorre `apps/web/app`, `apps/web/components`, `apps/web/lib` y `packages/*` y falla si algún archivo de código (salvo `brand.ts`) escribe el nombre a mano, con o sin espacios. Quedan afuera los textos legales, los tests, los e2e y las fixtures; los e2e que comprueban que la vitrina pública **no** nombra el producto leen `BRAND.name` en vez de repetirlo, así siguen sirviendo después de un cambio de nombre.

La vitrina pública (`(public)/layout.tsx`, `opengraph-image.tsx`) no lleva el nombre a propósito; no hay `manifest`. Por eso un cambio de nombre no la toca.

## Lo que todavía hay que cambiar a mano
- **Color primario de los botones:** hay 59 usos de `bg-zinc-900` en 51 archivos de `apps/web/app` y `apps/web/components`.
  - Hoy el token `brand` vale lo mismo, así que no hay diferencia visible.
  - El día que la marca tenga color propio, se reemplaza `bg-zinc-900` por `bg-brand` y `hover:bg-zinc-800` por `hover:bg-brand-hover` en los botones primarios. Es un reemplazo mecánico; revisá el contraste con el e2e 70 (axe).
- **Textos legales:** `apps/web/content/legal/terminos.md` (§1, «Qué es…») y `privacidad.md` (primer párrafo) nombran el producto en el texto. Son carril rojo y los revisa Mauro. Cambiar el nombre ahí implica subir `TERMS_VERSION` y que todos vuelvan a aceptar.
- **Docs y README:** `README.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/USO_DIARIO.md` y `docs/DEPLOY.md` (el nombre del conector MCP en claude.ai). Son historia del proyecto: se actualizan si hace falta, sin apuro.
- **Smoke:** el ejemplo de `SMOKE_BASE_URL` en `apps/web/playwright.smoke.config.ts` es solo un comentario.
- **Logo dibujado:** no hay. Cuando lo haya, va como `apps/web/app/icon.svg` (y `apple-icon.png` si hace falta), y en el header de `(app)/layout.tsx`, `onboarding/layout.tsx` y `legal/layout.tsx`, que hoy muestran `PRODUCT_NAME` como texto.

## Checklist para un cambio de nombre
1. `BRAND.name` y, si cambia, `BRAND.repoUrl`.
2. Colores e ícono, si cambian.
3. Variables en Vercel: `SITE_URL`, `EMAIL_FROM` y el dominio de entrada.
4. PR rojo de legales con el nombre nuevo y `TERMS_VERSION`.
5. Los filtros de Gmail ya creados siguen funcionando: filtran por el remitente de cada alerta y reenvían a la dirección de la persona, así que el nombre solo aparece en su título. Los que se generen después llevan el nombre nuevo.
6. Smoke ✅ después del deploy.
