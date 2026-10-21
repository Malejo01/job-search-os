/**
 * Motivo de descarte del prefiltro en castellano llano, para mostrarlo a la persona.
 * Recibe lo que guarda `jobs.prefilter_reason`: `"<reason>: <detail>"` (o solo `"<reason>"`).
 * Puro. El texto del detail puede traer cualquier carácter: React escapa al renderizar.
 */
export function prefilterReasonText(stored: string | null | undefined): string | null {
  const text = (stored ?? "").trim();
  if (text === "") return null;

  const sep = text.indexOf(":");
  const reason = (sep === -1 ? text : text.slice(0, sep)).trim();
  const detail = sep === -1 ? "" : text.slice(sep + 1).trim();

  switch (reason) {
    case "modalidad_no_remota":
      return "Es híbrida o presencial, y no aceptás esa modalidad.";
    case "idioma_no_aceptado":
      return detail.includes("inglés")
        ? "El aviso está en inglés, y elegiste ofertas solo en español."
        : detail.includes("español")
          ? "El aviso está en español, y elegiste ofertas solo en inglés."
          : "El aviso está en un idioma que no elegiste.";
    case "disciplina_distinta": {
      const area = quoted(detail);
      return area ? `El puesto es de otra área (${area}).` : "El puesto es de otra área.";
    }
    case "badge_aptitudes": {
      const n = /(\d+(?:[.,]\d+)?)\s*%/.exec(detail)?.[1];
      return n
        ? `Coincidís con pocas de las aptitudes que pide el aviso (${n} %).`
        : "Coincidís con pocas de las aptitudes que pide el aviso.";
    }
    case "titulo_blocklist": {
      const word = quoted(detail);
      return word
        ? `El título incluye «${word}», que está en los títulos que excluís en tus criterios.`
        : "El título incluye una palabra que está en los títulos que excluís en tus criterios.";
    }
    default:
      return "No pasó el filtro inicial.";
  }
}

/** Lo que va entre comillas simples en el detail, recortado; null si no hay. */
function quoted(detail: string): string | null {
  const m = /'([^']*)'/.exec(detail);
  const value = m?.[1]?.trim() ?? "";
  return value === "" ? null : value;
}
