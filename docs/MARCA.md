# Marca: dónde está y cómo se cambia (C-15, C7-2)

El nombre es **AfinIAJobs** («IA» y la «J» en mayúscula) en todas partes: UI, títulos, metadata, logo, favicon, ícono de app, imágenes OG, emails, manifest y textos legales. La fuente del diseño es `docs/ux/rediseno-afiniajobs/` (README y artboards M2 a M8).

Ani todavía no revisó la marca: lo que pida tiene que ser un PR chico. Por eso todo sale de pocos lugares.

## Lo que sale de un solo lugar
| Qué | Dónde | Cómo se cambia |
|---|---|---|
| Nombre visible: títulos, header, emails, filtros de Gmail, manifest, `aria-label` del logo | `packages/pipeline/src/brand.ts`: `BRAND.wordmark` (las dos partes del logotipo) y `BRAND.name`, que es su unión. `PRODUCT_NAME` sale de ahí | Una línea |
| Bajada («Ofertas afines. CV afinado.») | `BRAND.tagline` | Una línea |
| Logo en pantalla (monograma, logotipo y variantes) | `apps/web/components/brand/logo.tsx` (`<Logo>`) y la geometría del monograma en `components/brand/monogram.ts` | Un componente |
| Colores del logo según el modo | Tokens `--jso-logo-*` en `apps/web/app/globals.css` (claro y oscuro) | Ocho líneas |
| Colores de la app | `apps/web/app/globals.css` (ver `docs/ux/tokens.md`) | Tokens |
| Colores fuera de CSS (imágenes OG, manifest, emails) | `BRAND_COLORS` en `brand.ts`. Un test (`brand.test.ts`) verifica que coincidan con `globals.css` | Una línea por color |
| Tipografías | `apps/web/app/fonts.ts` (Sora y Manrope con `next/font/local`, archivos en `apps/web/assets/fonts`) y, para las imágenes OG, `apps/web/assets/fonts/` | Un archivo |
| Favicon | `apps/web/app/icon.svg` (monograma índigo sobre lima, sin el punto: a 16 px no se lee) | Reemplazar el archivo |
| Ícono de iPhone y del manifest | `apps/web/app/apple-icon.png` (180 px) y `apps/web/public/icons/` (192, 512 y 512 `maskable`) | Reemplazar los PNG |
| Manifest | `apps/web/app/manifest.ts` (nombre, colores e íconos) | Sale de `BRAND` y `BRAND_COLORS` |
| Imágenes para compartir | `apps/web/lib/og-image.tsx`, usada por `(public)/opengraph-image.tsx`, `twitter-image.tsx` y `(public-en)/opengraph-image-en` | Un componente |
| Encabezado de los emails | `packages/pipeline/src/email-layout.ts` (`brandedEmailHtml`): logotipo en texto sobre índigo, sin imágenes remotas | Un archivo |
| `User-Agent` hacia las fuentes públicas del pool | `SOURCE_USER_AGENT_BASE` (`packages/adapters/src/sources/user-agent.ts`): `BRAND.name` + `/1.0` | Sale solo de `BRAND.name` |
| Repositorio público («Cómo está hecho») | `BRAND.repoUrl` | Una línea |
| URL pública (metadata, sitemap, robots, links de email) | Variable `SITE_URL` (`apps/web/lib/site-url.ts`) | Vercel, Puerta 3 |
| Remitente de los emails | Variable `EMAIL_FROM`; sin ella, `BRAND.name` con el sandbox de Resend | Vercel, Puerta 3 |
| Dominio del email entrante | Variables de ingesta (`docs/DEPLOY.md`) | Vercel y DNS, Puerta 3 |

## El logo

`<Logo>` es un Server Component sin JS:

- `variant`: `full` (monograma + logotipo), `mark` (solo monograma) o `wordmark` (solo el texto).
- `tone`: el fondo. `auto` acompaña al modo (índigo e índigo vivo en claro; lima y blanco en oscuro). `light`, `dark` y `accent` (sobre lima) son fijos; el header tinta lleva `dark`.
- `size`: `sm` (header: monograma de 30 px, letra de 22 px), `md` (login) y `lg`.
- Para lectores de pantalla es una imagen con el nombre `BRAND.name`; con `decorative` se oculta.

Logotipo: «AfinIA» en Sora 800 y «Jobs» en Sora 300, con tracking −4 %. Sobre oscuro (índigo), «AfinIA» lima `#C6F25B` y «Jobs» blanco; sobre claro, «AfinIA» índigo `#1E1B4B` y «Jobs» índigo vivo `#4338CA`. Paleta «índigo y lima» elegida el 3/11 (reemplaza a la tinta y naranja del manual); detalle en `docs/ux/tokens.md`.

Dónde está: headers de la app con sesión, onboarding, legales, `terminos-actualizados`, la vitrina pública (en español e inglés; a menos de 640 px va solo el logotipo para que entre con «Entrar» y «Pedir acceso») y las pantallas de cuenta (login, registro, setup, olvidé y reset).

## Dónde revisarla

**`/settings/marca`** (solo para quien administra la beta, R-1): el logo en sus variantes y fondos, y dos paneles lado a lado, claro y oscuro, con los tokens y su valor real, las tipografías y todos los componentes con sus estados. Es la página para que Ani revise la marca sin recorrer la app.

## Guardas (tests)

- `packages/pipeline/src/brand.test.ts`:
  - ningún archivo de código, salvo `brand.ts`, escribe el nombre a mano (C6-2);
  - ningún texto de la app (código, contenido, SVG, JSON) escribe «Job Search OS» ni una variante mal escrita del nombre («afiniajobs», «AfiniaJobs», «Afinia Jobs»…). Se permiten URLs, dominios, emails y la clave técnica `job-search-os` (C7-2);
  - `BRAND_COLORS` coincide con los tokens de `globals.css`.
- e2e 105: `/settings/marca` sin violaciones de axe en los dos paneles (el logo sobre lima queda afuera: es un logotipo, exceptuado del contraste por WCAG 1.4.3).
- e2e 44: el header público lleva el logo con el nombre, los títulos públicos llevan el nombre, y el favicon, el ícono de iPhone, el manifest y las imágenes OG se sirven sin sesión.

## Lo que no cambia con el nombre (a propósito)

- **Servidor MCP:** `serverInfo.name` sigue siendo `job-search-os`. Cambiarlo rompe el conector ya configurado en claude.ai.
- **Direcciones de ingesta de email, `EMAIL_FROM` y `SITE_URL`:** son variables de Vercel; no se tocan desde el código.
- **Repo, paquetes (`@job-search-os/*`) y la clave `jso-` del `localStorage`:** son identificadores técnicos, no texto visible.
- **Filtros de Gmail ya creados:** siguen funcionando (filtran por remitente); solo su título lleva el nombre viejo. Los nuevos llevan el nuevo.

## Lo que todavía hay que cambiar a mano
- **Textos legales** (`apps/web/content/legal/`): carril rojo, con `TERMS_VERSION` (C7-3).
- **Docs y README:** `README.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/USO_DIARIO.md` y `docs/DEPLOY.md` cuentan la historia del proyecto con el nombre viejo. Se actualizan si hace falta, sin apuro.

## Checklist para un cambio de nombre o de logo
1. `BRAND.wordmark` (y `BRAND.repoUrl` si cambia).
2. Colores: tokens de `globals.css` y `BRAND_COLORS`.
3. Ícono: `icon.svg`, `apple-icon.png` y `public/icons/` (se regeneran desde el monograma).
4. Variables en Vercel si cambian: `SITE_URL`, `EMAIL_FROM` y el dominio de entrada.
5. PR rojo de legales con el nombre nuevo y `TERMS_VERSION`.
6. Smoke ✅ después del deploy.
