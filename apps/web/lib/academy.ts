import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLegalMarkdown, type BlockNode, type InlineNode } from "@job-search-os/pipeline";
import { isPrivilegedEmail } from "./invitations-core";

/**
 * Academy: fichas en Markdown versionado (`apps/web/content/academy/*.md`), cada una con frontmatter
 * `titulo`, `estado` (`borrador` o `aprobada`) y `orden`. Se leen en el servidor, del disco, y se
 * parsean con el mismo Markdown mínimo de los textos legales: nunca se arma HTML como string ni se
 * inyecta contenido sin sanear.
 *
 * Falla cerrado: solo `estado: aprobada` (exacto) se publica; cualquier otro valor, o ninguno, es
 * borrador.
 */
export type AcademyEstado = "borrador" | "aprobada";

export type AcademyFicha = {
  slug: string;
  titulo: string;
  estado: AcademyEstado;
  orden: number;
  blocks: BlockNode[];
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Una ficha a partir de su archivo; `null` si el nombre o el título no sirven. */
export function parseFicha(slug: string, raw: string): AcademyFicha | null {
  if (!SLUG.test(slug)) return null;
  const doc = parseLegalMarkdown(raw);
  const titulo = doc.meta.titulo?.trim();
  if (!titulo) return null;
  const orden = Number(doc.meta.orden);
  return {
    slug,
    titulo,
    estado: doc.meta.estado?.trim() === "aprobada" ? "aprobada" : "borrador",
    orden: Number.isFinite(orden) ? orden : 999,
    blocks: doc.blocks,
  };
}

/** Solo lo publicable: las aprobadas. */
export function onlyApproved(fichas: readonly AcademyFicha[]): AcademyFicha[] {
  return fichas.filter((f) => f.estado === "aprobada");
}

function inlineText(nodes: InlineNode[]): string {
  return nodes
    .map((n) => (n.type === "text" || n.type === "code" ? n.text : inlineText(n.children)))
    .join("");
}

/** Palabras del cuerpo de la ficha (sin el frontmatter). */
export function fichaWordCount(ficha: Pick<AcademyFicha, "blocks">): number {
  const texts = ficha.blocks.flatMap((b): string[] => {
    switch (b.type) {
      case "heading":
      case "paragraph":
      case "quote":
        return [inlineText(b.children)];
      case "list":
        return b.items.map(inlineText);
      case "table":
        return [...b.header, ...b.rows.flat()].map(inlineText);
    }
  });
  return texts.join(" ").split(/\s+/).filter(Boolean).length;
}

/** ¿Esta cuenta puede ver los borradores? Admins y testers (las mismas listas de siempre). */
export function mayReviewAcademy(
  email: string | null | undefined,
  env: Record<string, string | undefined>,
): boolean {
  if (!email) return false;
  return isPrivilegedEmail(email, env);
}

// Rutas con `join(process.cwd(), "<literal>")` para que el trazado de Next/Vercel incluya los .md
// (ver `outputFileTracingIncludes`). En el monorepo cwd puede ser la raíz o apps/web.
function dir(): string | null {
  return (
    [
      join(process.cwd(), "content", "academy"),
      join(process.cwd(), "apps", "web", "content", "academy"),
    ].find((p) => existsSync(p)) ?? null
  );
}

/** Todas las fichas (borradores incluidos), ordenadas. Solo servidor. */
export function loadAcademyFichas(): AcademyFicha[] {
  const base = dir();
  if (!base) return [];
  const fichas: AcademyFicha[] = [];
  for (const file of readdirSync(base)) {
    if (!file.endsWith(".md")) continue;
    const f = parseFicha(file.slice(0, -3), readFileSync(join(base, file), "utf8"));
    if (f) fichas.push(f);
  }
  return fichas.sort((a, b) => a.orden - b.orden || a.slug.localeCompare(b.slug));
}

export function loadApprovedFichas(): AcademyFicha[] {
  return onlyApproved(loadAcademyFichas());
}

/** Una ficha aprobada por su slug; `null` si no existe o sigue en borrador. */
export function loadApprovedFicha(slug: string): AcademyFicha | null {
  return loadApprovedFichas().find((f) => f.slug === slug) ?? null;
}
