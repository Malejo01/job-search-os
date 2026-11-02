/**
 * Marca del producto en un solo lugar (C-15, C7-2). Cambiar de nombre es editar este archivo, los
 * tokens de `apps/web/app/globals.css` y lo que lista `docs/MARCA.md` (textos legales, README y
 * docs, que se cambian a mano).
 *
 * Lo que depende del entorno NO va acá: la URL pública sale de `SITE_URL` (`apps/web/lib/site-url.ts`)
 * y la dirección del remitente de `EMAIL_FROM`. Acá queda solo lo que es igual en todos los entornos.
 */

/**
 * Logotipo (manual de marca, decisión de Mauro del 2/11): «AfinIA» en Sora 800 y «Jobs» en Sora 300.
 * El nombre visible es la unión de las dos partes, así nunca se desalinean.
 */
const WORDMARK = { strong: "AfinIA", light: "Jobs" } as const;

export const BRAND = {
  /** Nombre visible: títulos, header, emails, filtros de Gmail y `aria-label` del logo. */
  name: `${WORDMARK.strong}${WORDMARK.light}`,
  /** Las dos partes del logotipo, con su peso: `strong` (Sora 800) y `light` (Sora 300). */
  wordmark: WORDMARK,
  /** Bajada principal (manual M7). */
  tagline: "Ofertas afines. CV afinado.",
  /** Repositorio público, enlazado desde «Cómo está hecho». */
  repoUrl: "https://github.com/Malejo01/job-search-os",
} as const;

/**
 * Colores de marca para lo que no lee CSS: imágenes OG, ícono, manifest y emails. En la app los
 * colores salen de los tokens de `globals.css` (mismos valores); este objeto es su espejo para esos
 * contextos y un test verifica que coincidan.
 */
export const BRAND_COLORS = {
  /** Tinta: texto sobre claro y fondo oscuro. */
  ink: "#050505",
  /** Naranja de acción y marca. Solo relleno con texto tinta, o texto sobre oscuro. */
  orange: "#FF6A13",
  /** Naranja profundo: el único naranja para texto sobre claro. */
  deepOrange: "#C2410C",
  white: "#FFFFFF",
  /** Fondo de página claro (Stone 100). */
  stone100: "#F5F5F4",
  /** Bordes claros (Stone 200). */
  stone200: "#E7E5E4",
  /** Texto secundario claro (Stone 600). */
  stone600: "#57534E",
  /** Texto secundario sobre tinta (Stone 300). */
  stone300: "#D6D3D1",
} as const;
