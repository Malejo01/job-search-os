import type { JobCard } from "../job-card/schema";

/**
 * La ficha del aviso como entra al prompt de `evaluate_job@v1.5.0` (`{{ficha}}`, R31-06). Puro.
 *
 * Es texto que salió de un aviso de terceros (pasó por el modelo de extracción y por `verifyJobCard`): sigue
 * siendo un DATO. Va entre `<<<FICHA>>>` y `<<<FIN FICHA>>>`, con las marcas del texto escapadas y cada valor en
 * una sola línea, así nada de lo que diga puede abrir ni cerrar la sección. Sin citas ni resumen (ya viajan en
 * `{{job}}`) para no pagar dos veces el mismo texto. Lo que la ficha no dice sale «No especificado»: nada se
 * completa. Con la ficha apagada o ausente, el prompt dice que lea esos datos del aviso.
 */
export const FICHA_OPEN = "<<<FICHA>>>";
export const FICHA_CLOSE = "<<<FIN FICHA>>>";
export const FICHA_NOT_AVAILABLE =
  "FICHA NO DISPONIBLE: leé las condiciones, los requisitos y las habilidades directamente del aviso.";
/** Tope de la ficha en el prompt, marcas incluidas. */
export const FICHA_PROMPT_MAX_CHARS = 6000;

const NOT_SPECIFIED = "No especificado";
const VALUE_MAX = 400;

/** Una sola línea, sin marcas del prompt y con largo acotado. */
const clean = (text: string): string =>
  text
    .replaceAll("<<<", "‹‹‹")
    .replaceAll(">>>", "›››")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, VALUE_MAX);

const alcance = (c: NonNullable<JobCard["condiciones"]["desdeDonde"]>): string => {
  const lugares = c.lugares.map(clean).join(", ");
  switch (c.alcance) {
    case "cualquier_pais":
      return "Desde cualquier país";
    case "paises":
    case "ciudad":
      return `Solo desde: ${lugares || NOT_SPECIFIED}`;
    case "contradictorio":
      return `El aviso dice cualquier país, pero también pide estar en uno${lugares ? ` (${lugares})` : ""}`;
  }
};

export function renderJobCardForPrompt(
  card:
    | Pick<JobCard, "requisitos" | "condiciones" | "habilidades" | "area" | "idioma">
    | null
    | undefined,
): string {
  if (!card) return FICHA_NOT_AVAILABLE;
  const c = card.condiciones;
  const head = [
    `Área: ${card.area ? clean(card.area.valor) : NOT_SPECIFIED}`,
    `Idioma del aviso: ${card.idioma.valor}`,
    `Modalidad: ${c.modalidad ? c.modalidad.valor : NOT_SPECIFIED}`,
    `Desde dónde: ${c.desdeDonde ? alcance(c.desdeDonde).slice(0, VALUE_MAX) : NOT_SPECIFIED}`,
    `Salario: ${c.salario ? clean(c.salario.texto) : NOT_SPECIFIED}`,
    `Experiencia: ${c.experiencia ? clean(c.experiencia.texto) : NOT_SPECIFIED}`,
    `Inglés: ${
      c.ingles
        ? `${c.ingles.nivel === "sin_nivel" ? "sin nivel indicado" : c.ingles.nivel}${c.ingles.nivelTexto ? ` (${clean(c.ingles.nivelTexto)})` : ""}`
        : NOT_SPECIFIED
    }`,
    `Jornada: ${c.jornada ? c.jornada.valor : NOT_SPECIFIED}`,
    `Contratación: ${c.contratacion ? c.contratacion.valor : NOT_SPECIFIED}`,
  ];
  const reqs = card.requisitos.length
    ? [
        "Requisitos:",
        ...card.requisitos.map((r) => `- [${r.nivel}] (${r.categoria}) ${clean(r.texto)}`),
      ]
    : [`Requisitos: ${NOT_SPECIFIED}`];
  // Nueve líneas de hasta 400 caracteres más esta (600) caben siempre bajo el tope
  const skills = card.habilidades.length
    ? `Habilidades: ${card.habilidades.map((h) => clean(h.nombre)).join("; ")}`.slice(0, 600)
    : `Habilidades: ${NOT_SPECIFIED}`;

  // Con tope: se cortan primero los requisitos del final; las marcas siempre quedan cerradas
  const room = FICHA_PROMPT_MAX_CHARS - FICHA_OPEN.length - FICHA_CLOSE.length - 2;
  const fixed = [...head, skills];
  let used = fixed.reduce((n, l) => n + l.length + 1, 0);
  const kept: string[] = [];
  for (const line of reqs) {
    if (used + line.length + 1 > room) break;
    kept.push(line);
    used += line.length + 1;
  }
  const body = [...head, ...kept, skills];
  return [FICHA_OPEN, ...body, FICHA_CLOSE].join("\n");
}
