# Marca: dónde está y cómo se cambia (C-15, C7-2, logo B2 en C9-4)

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
| Tipografías | `apps/web/app/fonts.ts` (Bricolage Grotesque y Figtree con `next/font/local`, archivos en `apps/web/assets/fonts`, C9-2) y, para las imágenes OG, `apps/web/assets/fonts/` | Un archivo |
| Favicon | `apps/web/app/icon.svg` (logo B2: la «A» de Bricolage 800 en índigo con el punto índigo vivo, sobre lima) | Reemplazar el archivo |
| Ícono de iPhone y del manifest | `apps/web/app/apple-icon.png` (180 px) y `apps/web/public/icons/` (192, 512 y 512 `maskable`) | Reemplazar los PNG |
| Manifest | `apps/web/app/manifest.ts` (nombre, colores e íconos) | Sale de `BRAND` y `BRAND_COLORS` |
| Imágenes para compartir | `apps/web/lib/og-image.tsx`, usada por `(public)/opengraph-image.tsx`, `twitter-image.tsx` y `(public-en)/opengraph-image-en` | Un componente |
| Encabezado de los emails | `packages/pipeline/src/email-layout.ts` (`brandedEmailHtml`): logotipo B2 en texto sobre índigo, con el punto lima, sin imágenes remotas; fuentes con fallback a Arial | Un archivo |
| `User-Agent` hacia las fuentes públicas del pool | `SOURCE_USER_AGENT_BASE` (`packages/adapters/src/sources/user-agent.ts`): `BRAND.name` + `/1.0` | Sale solo de `BRAND.name` |
| Repositorio público («Cómo está hecho») | `BRAND.repoUrl` | Una línea |
| URL pública (metadata, sitemap, robots, links de email) | Variable `SITE_URL` (`apps/web/lib/site-url.ts`) | Vercel, Puerta 3 |
| Remitente de los emails | Variable `EMAIL_FROM`; sin ella, `BRAND.name` con el sandbox de Resend | Vercel, Puerta 3 |
| Dominio del email entrante | Variables de ingesta (`docs/DEPLOY.md`) | Vercel y DNS, Puerta 3 |

## El logo

`<Logo>` es un Server Component sin JS:

- `variant`: `full` o `wordmark` (el logotipo con el punto; desde B2 son lo mismo) o `mark` (el monograma: la «A» con el punto).
- `tone`: el fondo. `auto` acompaña al modo (índigo e índigo vivo en claro; lima y blanco en oscuro). `light`, `dark` y `accent` (sobre lima) son fijos; el header tinta lleva `dark`.
- `size`: `sm` (header: letra de 24 px), `md` (login) y `lg`.
- Para lectores de pantalla es una imagen con el nombre `BRAND.name`; con `decorative` se oculta.

**Logo B2 (C9-4, decisión 4 de C9):** «AfinIA» en Bricolage Grotesque 800 y «Jobs» en 500, con tracking −3 % y **el punto de la marca** al final (un círculo sobre la línea de base). Sobre oscuro (índigo), «AfinIA» y el punto en lima `#C6F25B` y «Jobs» blanco; sobre claro, «AfinIA» índigo `#1E1B4B`, «Jobs» y el punto en índigo vivo `#4338CA`. El monograma es la «A» del mismo Bricolage 800 con el mismo punto (`components/brand/monogram.ts`, trazo sacado del glifo de la fuente): favicon, íconos y lugares chicos. Paleta «índigo y lima» elegida el 3/11; detalle en `docs/ux/tokens.md`.

Los PNG (`apple-icon.png`, `public/icons/*`) se generan con Playwright desde el mismo SVG: un HTML con el monograma sobre lima, captura al tamaño exacto (180, 192, 512 y 512 `maskable` con más margen).

Dónde está: headers de la app con sesión, onboarding, legales, `terminos-actualizados`, la vitrina pública (en español e inglés; a menos de 640 px va solo el logotipo para que entre con «Entrar» y «Pedir acceso») y las pantallas de cuenta (login, registro, setup, olvidé y reset).

## Voz y tono (C9-15)

«Amigo con onda», profesional y con consejos de coach. Se trata de «vos» y **nunca se promete trabajo**. Tres reglas:

1. **La onda va solo en los momentos tranquilos**: el saludo, los estados vacíos, los logros. Con un error o un puntaje bajo, el tono es claro y sereno: nada de «Uh», «Tranqui» ni chistes.
2. **Todo lo que falta se dice como un paso concreto.** No «Te falta Tango», sino «Sumá Tango y esta oferta te queda mucho más cerca».
3. **Guiños locales** (el mate, «te queda pintada», «te calza»): como mucho uno por pantalla.

Los botones dicen exactamente qué hacen («Ver mis ofertas», «Guardar descripción»), sin onda. Los textos que genera el modelo (fortalezas, debilidades, veredicto) no se reescriben: solo cambia cómo se presentan.

| Momento | Ejemplo |
|---|---|
| Saludo de Hoy | «¡Buen día, Lucía! Hoy hay 3 ofertas que te pueden quedar pintadas.» |
| Por qué del puntaje | «Te queda muy bien por tus 3 años en sueldos. Sumá Tango Gestión y quedás entre las mejores.» |
| Cercanía en el detalle | «Cumplís 4 de 5 requisitos. Te falta uno para quedar entre las mejores.» |
| Sin ofertas | «Todavía no llegó nada, pero estamos buscando todos los días. Mientras, dejá tu perfil a punto: elegí tus áreas.» |
| Error al guardar | «No pudimos guardar la descripción. Tu texto sigue acá: revisá la conexión y tocá Guardar otra vez.» |
| Botón | «Ver mis ofertas» |
| El sello | «Muy afín», «Bastante afín», «Afín a medias», «Poco afín», «Lejos de tu perfil»: la palabra siempre está, nunca solo el color |

Dónde viven los textos: los de las pantallas, en cada pantalla; los de la ayuda en contexto, en `packages/pipeline/src/help/ayuda-en-contexto.ts`; los que revisa Ani, juntos en `/settings/textos`. Los del sello y la tarjeta, en `packages/pipeline/src/score-display.ts` y `fit/offer-card.ts`.

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
