/**
 * Qué se encontró en el CV, en una frase (R10-1, R13-5). Solo conteos: nada del texto del CV. Módulo propio y
 * sin React para poder probarlo; lo usa `read-client.tsx`.
 */
export type Summary = {
  experience: number;
  education: number;
  /** R13-5: proyectos que leyó el CV (R12-5). Lecturas guardadas antes de este campo traen 0. */
  projects: number;
  skills: number;
  languages: number;
  dropped: number;
  suggestedRoles: string[];
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Trabajos, estudios, proyectos (solo si hay), skills e idiomas. */
export function summaryLine(s: Summary): string {
  return [
    plural(s.experience, "trabajo", "trabajos"),
    plural(s.education, "estudio", "estudios"),
    ...(s.projects > 0 ? [plural(s.projects, "proyecto", "proyectos")] : []),
    plural(s.skills, "skill", "skills"),
    plural(s.languages, "idioma", "idiomas"),
  ].join(", ");
}
