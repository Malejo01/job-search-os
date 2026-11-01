/**
 * Marca del producto en un solo lugar (C-15). Cambiar de nombre (por ejemplo, a uno definitivo antes
 * de la beta paga) es editar este archivo, los tokens `--jso-brand*` de `apps/web/app/globals.css`
 * y lo que lista `docs/MARCA.md` (textos legales, README y docs, que se cambian a mano).
 *
 * Lo que depende del entorno NO va acá: la URL pública sale de `SITE_URL` (`apps/web/lib/site-url.ts`)
 * y la dirección del remitente de `EMAIL_FROM`. Acá queda solo lo que es igual en todos los entornos.
 */
export const BRAND = {
  /** Nombre visible: títulos, header, emails y filtros de Gmail. */
  name: "AfinIAJobs",
  /** Repositorio público, enlazado desde «Cómo está hecho». */
  repoUrl: "https://github.com/Malejo01/job-search-os",
} as const;
