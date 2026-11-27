import type { CvDiagnosisFix, CvPendingKey } from "@job-search-os/pipeline";

/**
 * Diagnóstico (R33-06, tabla 8.2): a dónde lleva el botón de cada paso. Reusa los destinos de «Tu CV».
 * Sin chat abierto, lo que se hace charlando cae en la carga manual; `null` solo si no hay dónde.
 */
export function fixHref(fix: CvDiagnosisFix, opts: { chatVisible: boolean }): string | null {
  switch (fix) {
    case "add_summary":
      return pendingHref("summary", opts);
    case "add_experience":
      return pendingHref("experience", opts);
    case "add_education":
      return pendingHref("education", opts);
    case "add_skills":
      return pendingHref("skills", opts);
    case "add_languages":
      return pendingHref("languages", opts);
    case "add_headline":
      return opts.chatVisible ? "/cv/armar" : "/settings/perfil";
    case "add_contact":
      return "/settings/perfil";
    case "mark_keywords":
      return "/settings/skills#agregar-skill";
    case "write_achievement":
      return opts.chatVisible ? "/cv/armar" : "/settings/historial";
    case "edit_history":
      return "/settings/historial";
  }
}

/**
 * «Tu CV» (R33-01, C-04): a qué campo exacto lleva el botón de cada faltante. Los anclas son ids que ya
 * existen en cada pantalla. El resumen solo se escribe con el asistente (`/cv/armar`); sin él no hay dónde:
 * devuelve `null` y la pantalla lo dice en vez de mandar a un lugar equivocado.
 */
export function pendingHref(key: CvPendingKey, opts: { chatVisible: boolean }): string | null {
  switch (key) {
    case "summary":
      return opts.chatVisible ? "/cv/armar" : null;
    case "experience":
      return "/settings/historial?tipo=trabajo#nueva-organization";
    case "education":
      return "/settings/historial?tipo=educacion#nueva-organization";
    case "skills":
      return "/settings/skills#agregar-skill";
    case "languages":
      return "/settings/skills#ingles-cefr";
  }
}

/** Dónde sigue la persona que ya tiene algo cargado: el chat si está abierto, si no, lo primero que falta. */
export function continueHref(
  pending: readonly CvPendingKey[],
  opts: { chatVisible: boolean },
): string {
  if (opts.chatVisible) return "/cv/armar";
  for (const k of pending) {
    const href = pendingHref(k, opts);
    if (href) return href;
  }
  return "/settings/historial";
}
