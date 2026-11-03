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
  /** Índigo: base de marca (header, fondo de las imágenes) y texto sobre la lima. */
  ink: "#1E1B4B",
  /** Lima: acción y marca. Solo relleno con texto índigo, o texto sobre índigo. Nunca un estado. */
  accent: "#C6F25B",
  /** Índigo vivo: el acento como texto o foco sobre claro (7,9:1 contra blanco). */
  accentDeep: "#4338CA",
  white: "#FFFFFF",
  /** Fondo de página claro (Zinc 100 frío). */
  canvas: "#F5F5F7",
  /** Bordes claros. */
  line: "#E4E4EA",
  /** Texto secundario claro (Zinc 600). */
  textMuted: "#52525B",
  /** Texto secundario sobre índigo. */
  onInkMuted: "#C7C6E6",
} as const;
