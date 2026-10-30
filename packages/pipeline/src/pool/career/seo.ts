import type { CareerMarket } from "./types";

/**
 * SEO de la vitrina por carrera (C-18). Puro: arma la descripción y los datos estructurados de
 * `/mercado/<carrera>` con lo que dicen los datos del pool, sin texto inventado. Es un `Dataset`
 * (agregados propios sobre avisos públicos) y nunca un `JobPosting`: los avisos no son nuestros.
 */

/** Con menos avisos que esto, la descripción no nombra skills: serían ruido. */
export const SEO_MIN_JOBS = 10;
const TOP_SKILLS = 3;

function listEs(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

export function careerSeoDescription(market: CareerMarket, label: string): string {
  if (market.total < SEO_MIN_JOBS || market.smallSample) {
    return `Qué piden las ofertas públicas de ${label}: skills, inglés, seniority y sueldos.`;
  }
  const top = market.skills.slice(0, TOP_SKILLS).map((s) => s.name);
  const offers = `${market.total} ofertas públicas de ${label} en los últimos 30 días`;
  return top.length ? `${offers}. Lo más pedido: ${listEs(top)}.` : `${offers}.`;
}

export type CareerDatasetInput = {
  market: CareerMarket;
  label: string;
  /** URL absoluta de la página. */
  url: string;
};

/**
 * Datos estructurados schema.org `Dataset`, listos para `JSON.stringify`. Sin `creator`: la vitrina
 * pública no lleva el nombre del producto (ronda 63), tampoco en el código de la página.
 */
export function careerDatasetJsonLd(input: CareerDatasetInput): Record<string, unknown> {
  const { market, label, url } = input;
  const skills = market.skills.slice(0, 10).map((s) => s.name);
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `Mercado de ${label}: qué piden las ofertas`,
    description: careerSeoDescription(market, label),
    url,
    isAccessibleForFree: true,
    temporalCoverage: "P30D",
    dateModified: market.poolUpdatedAt ?? market.computedAt,
    variableMeasured: ["Skills pedidas", "Inglés", "Seniority", "Sueldos", "Modalidad"],
    keywords: [label, ...skills],
  };
}

// Separadores de línea y de párrafo de Unicode, armados por código para no tenerlos literales
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

const JSON_SCRIPT_ESCAPES = new Map<string, string>([
  ["<", "\\u003c"],
  [">", "\\u003e"],
  ["&", "\\u0026"],
  [LINE_SEPARATOR, "\\u2028"],
  [PARAGRAPH_SEPARATOR, "\\u2029"],
]);

/**
 * `JSON.stringify` seguro para un `<script type="application/ld+json">`: sin `<` literal no puede
 * cerrar el script. `>`, `&` y los separadores U+2028 y U+2029 también van escapados, por si alguien
 * reutiliza el helper en un script que sí se ejecuta. El resultado sigue siendo JSON válido.
 */
export function jsonLdString(data: unknown): string {
  let out = "";
  for (const c of JSON.stringify(data)) out += JSON_SCRIPT_ESCAPES.get(c) ?? c;
  return out;
}
