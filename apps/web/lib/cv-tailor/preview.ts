import type { CvDocument } from "@job-search-os/pipeline";

/**
 * Lo que se muestra de la versión adaptada: las entradas con viñetas (experiencia y proyectos) y las skills.
 * Son datos planos y sin formato; la pantalla los dibuja como texto, nunca como HTML.
 */
export type TailorPreview = {
  entries: { heading: string; detail: string | null; bullets: string[] }[];
  skills: string[];
};

export function buildTailorPreview(doc: CvDocument): TailorPreview {
  const entries = doc.sections
    .filter((s) => s.id === "experience" || s.id === "projects")
    .flatMap((s) => s.blocks)
    .filter((b) => b.bullets.length > 0)
    .map((b) => ({ heading: b.heading ?? "", detail: b.detail, bullets: [...b.bullets] }));
  const skills = (doc.sections.find((s) => s.id === "skills")?.blocks ?? [])
    .map((b) => b.detail)
    .filter((d): d is string => !!d);
  return { entries, skills };
}
