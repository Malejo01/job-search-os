import { BRAND } from "@job-search-os/pipeline";
import type { Metadata } from "next";

/**
 * `openGraph` de las páginas públicas, en un solo lugar. En Next el `openGraph` de una página
 * reemplaza entero al del layout: por eso cada página lo arma con `publicOpenGraph`, que repite los
 * valores base de los layouts y suma `og:url` (la canónica). Puro: sin I/O.
 */
type OpenGraph = NonNullable<Metadata["openGraph"]>;

export const ES_DESCRIPTION =
  "Cargás tu perfil, la IA lee cada aviso contra lo que sabés y lo que buscás, y vos decidís. Nunca postulamos por vos.";
export const ES_TITLE = `${BRAND.name} · ${BRAND.tagline}`;
// La imagen en español con ruta fija: el route handler `(public)/opengraph-image-es/route.tsx`. La de
// `(public)/opengraph-image.tsx` lleva un sufijo de Next (grupo de rutas; `/opengraph-image` a secas da
// 404) y en las páginas anidadas con `openGraph` propio Next no la agrega
export const ES_IMAGE = { url: "/opengraph-image-es", width: 1200, height: 630 } as const;

export const EN_TAGLINE =
  "We read each job posting against your profile and tell you why or why not";
export const EN_DESCRIPTION =
  "You load your profile, the AI reads each posting against what you know and what you look for, and you decide. It never applies for you.";
// La imagen en inglés es el route handler `opengraph-image-en/route.tsx` (ronda 122)
export const EN_IMAGE = {
  url: "/opengraph-image-en",
  width: 1200,
  height: 630,
  alt: EN_TAGLINE,
} as const;

/** Base del layout `(public)`. */
export const ES_OPEN_GRAPH = {
  title: ES_TITLE,
  description: ES_DESCRIPTION,
  type: "website",
  locale: "es_AR",
  siteName: BRAND.name,
} satisfies OpenGraph;

/** Base del layout `(public-en)`. */
export const EN_OPEN_GRAPH = {
  title: EN_TAGLINE,
  description: EN_DESCRIPTION,
  type: "website",
  locale: "en_US",
  siteName: BRAND.name,
  images: [EN_IMAGE],
} satisfies OpenGraph;

/** `openGraph` de una página pública: la base del layout + `url` = ruta canónica (relativa a `metadataBase`). */
export function publicOpenGraph(input: {
  path: string;
  title?: string;
  description?: string;
  lang?: "es" | "en";
}): OpenGraph {
  const en = input.lang === "en" || input.path.startsWith("/en/");
  const base = en ? EN_OPEN_GRAPH : { ...ES_OPEN_GRAPH, images: [ES_IMAGE] };
  return {
    ...base,
    title: input.title ?? base.title,
    description: input.description ?? base.description,
    url: input.path,
  };
}
