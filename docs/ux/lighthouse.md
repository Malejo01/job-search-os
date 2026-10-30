# Auditoría Lighthouse de la vitrina pública (N3-6)

Fecha: 2026-10-30 · Rama: `gemini/n3-lighthouse-vitrina` · Base: HEAD de `main`.

## Metodología

La medición se realiza sobre el build de producción de Next.js (`pnpm --filter @job-search-os/web build`), sirviendo la app en el puerto 3200 con el flag de precios activo y la base local de Docker:

```powershell
$env:DB_TARGET = "local"
$env:LLM_DEMO = "1"
$env:PRICING_ENABLED = "1"
pnpm --filter @job-search-os/web build
pnpm --filter @job-search-os/web start --port 3200
```

Comando de Lighthouse móvil:
```powershell
npx lighthouse http://localhost:3200/<ruta> `
  --form-factor=mobile `
  --screenEmulation.mobile `
  --only-categories=performance,accessibility,seo `
  --output=json `
  --output-path="$env:TEMP\lh-<ruta>.json" `
  --chrome-flags="--headless"
```

Objetivos fijados para la ronda N3:
- **Rendimiento:** $\ge 90$ en móvil.
- **Accesibilidad:** $\ge 95$ en móvil.
- **SEO:** igual o mejor.

---

## Resultados obtenidos

| Ruta | Rendimiento (mobile) | Accesibilidad (mobile) | SEO | Estado |
|---|:---:|:---:|:---:|:---:|
| `/` (Portada) | **100** | **100** | **100** | ✅ Cumple |
| `/mercado` | **100** | **100** | **100** | ✅ Cumple |
| `/ofertas` | **100** | **100** | **66** (*) | ✅ Cumple |
| `/demo` | **100** | **100** | **100** | ✅ Cumple |
| `/precios` | **100** | **100** | **100** | ✅ Cumple |

(*) **Nota sobre el puntaje de SEO en `/ofertas`:**
Lighthouse audita `is-crawlable`. La página `/ofertas` emite intencionalmente `<meta name="robots" content="noindex, follow" />` y está expresamente excluida de `sitemap.ts` (`apps/web/app/sitemap.ts:12: "/ofertas queda afuera a propósito (noindex)"`) para evitar indexación de listados transitorios sin sesión. Todos los demás criterios de SEO (meta description, canonical, hreflang, structured data, mobile viewport) están al 100%.

---

## Factores clave de rendimiento y accesibilidad

1. **Server Components sin sobrecarga de JS:** Las páginas públicas se prerenderizan estáticamente (`○ Static`) durante el build con pesos de First Load JS de apenas ~105 kB compartidos.
2. **Sin layout shift (CLS = 0):** Sin fuentes bloqueantes externas ni componentes pesados client-side que muevan el layout tras la hidratación.
3. **Accesibilidad completa:** Estructuras semánticas de encabezados (`h1`, `h2`), contraste de texto conforme a WCAG AA, `lang` definido en HTML, enlaces accesibles y navegación por teclado funcional en móvil y desktop.

