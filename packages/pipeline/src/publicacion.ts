/**
 * Publicación por huella (R26-01 y R26-02). Quien revisa (admins y testers) puede aprobar desde la app una
 * ficha de Academy o un texto del rediseño sin esperar un deploy. La aprobación guarda la **huella**
 * (sha256 en hexadecimal) del contenido que se miró: si el contenido cambia, la huella cambia y la
 * aprobación vieja ya no vale. Función pura, sin I/O: el hash lo calcula la web y lo pasa.
 *
 * Falla cerrado: solo se publica con una causa clara (el archivo dice `aprobada`, o la base tiene una
 * aprobación vigente con la misma huella). Cualquier otra cosa es borrador.
 */

export type RevisionEstado = "aprobada" | "cambios";

/** Lo último que se dijo en la base sobre un contenido: el estado y la huella de lo que se miró. */
export type RevisionVigente = { estado: RevisionEstado; huella: string };

export type MotivoPublicacion =
  | "archivo"
  | "aprobada_en_base"
  | "sin_revision"
  | "cambios_pedidos"
  | "huella_distinta"
  | "huella_invalida";

export type DecisionPublicacion = { publicada: boolean; motivo: MotivoPublicacion };

const HUELLA = /^[0-9a-f]{64}$/;

/** ¿Es un sha256 en hexadecimal minúscula? */
export function esHuellaValida(huella: string | null | undefined): boolean {
  return typeof huella === "string" && HUELLA.test(huella);
}

/**
 * ¿Se publica? `archivoEstado` es lo que dice el archivo del repo; `huellaActual`, la huella del contenido
 * de hoy; `revision`, lo último que dijo quien revisa en la base (o `null`).
 */
export function decidirPublicacion(input: {
  archivoEstado: "aprobada" | "borrador";
  huellaActual: string;
  revision: RevisionVigente | null;
}): DecisionPublicacion {
  if (input.archivoEstado === "aprobada") return { publicada: true, motivo: "archivo" };
  if (!input.revision) return { publicada: false, motivo: "sin_revision" };
  if (input.revision.estado !== "aprobada") return { publicada: false, motivo: "cambios_pedidos" };
  if (!esHuellaValida(input.huellaActual) || !esHuellaValida(input.revision.huella)) {
    return { publicada: false, motivo: "huella_invalida" };
  }
  if (input.revision.huella !== input.huellaActual) {
    return { publicada: false, motivo: "huella_distinta" };
  }
  return { publicada: true, motivo: "aprobada_en_base" };
}

/** Lo último que dijo quien revisa sobre un texto del rediseño: aprobó ese texto o propuso otro. */
export type RevisionDeTexto = { estado: "aprobada" | "propuesta"; huella: string };

export type EstadoDeTexto =
  "sin_revisar" | "aprobado" | "cambio_el_codigo" | "propuesta" | "propuesta_vieja";

/**
 * Estado de un texto del rediseño (R26-02). `huellaActual` es la huella del texto por defecto que hay hoy en el
 * código. Solo «aprobado» cuenta como aprobado: una aprobación sobre otro texto (el código cambió) ya no vale, y
 * una propuesta nunca aprueba ni cambia la app (la pasa al código quien administra). Falla cerrado ante una huella ilegible.
 */
export function estadoDeTexto(
  huellaActual: string,
  revision: RevisionDeTexto | null,
): EstadoDeTexto {
  if (!revision || !esHuellaValida(huellaActual) || !esHuellaValida(revision.huella)) {
    return "sin_revisar";
  }
  const vigente = revision.huella === huellaActual;
  if (revision.estado === "aprobada") return vigente ? "aprobado" : "cambio_el_codigo";
  return vigente ? "propuesta" : "propuesta_vieja";
}

/** Cuántos de `textos` (los de hoy) están aprobados con su huella de hoy. Las revisiones de textos que ya no existen no cuentan. */
export function contarTextosAprobados(
  textos: readonly { clave: string; huella: string }[],
  revisiones: ReadonlyMap<string, RevisionDeTexto>,
): { total: number; aprobados: number } {
  let aprobados = 0;
  for (const t of textos) {
    if (estadoDeTexto(t.huella, revisiones.get(t.clave) ?? null) === "aprobado") aprobados += 1;
  }
  return { total: textos.length, aprobados };
}

/**
 * Contenido de una ficha de Academy que entra en la huella: el archivo entero menos la línea `estado` del
 * frontmatter (para que aprobar en el archivo no invalide la propia aprobación). Fines de línea unificados
 * y sin espacios al final de cada línea ni del archivo. Solo se quita `estado` dentro del frontmatter.
 */
export function canonicalAcademyContent(raw: string): string {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let inFront = false;
  let frontClosed = false;
  for (const [i, line] of lines.entries()) {
    if (i === 0 && line.trim() === "---") {
      inFront = true;
      out.push(line);
      continue;
    }
    if (inFront && line.trim() === "---") {
      inFront = false;
      frontClosed = true;
      out.push(line);
      continue;
    }
    if (inFront && !frontClosed && /^estado\s*:/.test(line)) continue;
    out.push(line);
  }
  return out
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
}
