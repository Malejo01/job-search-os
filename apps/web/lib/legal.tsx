import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import {
  fillLegalPlaceholders,
  parseLegalMarkdown,
  type BlockNode,
  type InlineNode,
  type LegalDocument,
} from "@job-search-os/pipeline";

export type LegalName = "privacidad" | "terminos";

/**
 * Los textos viajan en el bundle porque están dentro de apps/web (`content/legal/*.md`) y las
 * rutas se arman con path.join(process.cwd(), "<literal>"): así el trazado de archivos de
 * Next/Vercel los incluye sin tocar next.config. `apps/web/content/legal/` es la única fuente
 * de privacidad.md y terminos.md (sin copia en docs/). En el monorepo cwd puede ser la raíz
 * o apps/web, por eso hay dos candidatos por archivo.
 */
function candidates(name: LegalName): string[] {
  return name === "privacidad"
    ? [
        join(process.cwd(), "content", "legal", "privacidad.md"),
        join(process.cwd(), "apps", "web", "content", "legal", "privacidad.md"),
      ]
    : [
        join(process.cwd(), "content", "legal", "terminos.md"),
        join(process.cwd(), "apps", "web", "content", "legal", "terminos.md"),
      ];
}

export function loadLegalDocument(name: LegalName): LegalDocument {
  const path = candidates(name).find((p) => existsSync(p));
  if (!path) throw new Error(`No se encontró el texto legal "${name}"`);
  return parseLegalMarkdown(readFileSync(path, "utf8"));
}

/**
 * Igual que loadLegalDocument pero con los datos legales de las variables LEGAL_* (JS-120). Se
 * lee `process.env` en cada request: las páginas que lo usan son dinámicas. Los valores no se loguean.
 */
function loadFilledLegalDocument(name: LegalName): LegalDocument {
  const path = candidates(name).find((p) => existsSync(p));
  if (!path) throw new Error(`No se encontró el texto legal "${name}"`);
  const filled = fillLegalPlaceholders(readFileSync(path, "utf8"), {
    LEGAL_RESPONSABLE: process.env.LEGAL_RESPONSABLE,
    LEGAL_DOMICILIO: process.env.LEGAL_DOMICILIO,
    LEGAL_EMAIL: process.env.LEGAL_EMAIL,
    LEGAL_LOG_DAYS: process.env.LEGAL_LOG_DAYS,
  });
  return parseLegalMarkdown(filled);
}

function renderInline(nodes: InlineNode[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.type) {
      case "text":
        return n.text;
      case "strong":
        return <strong key={i}>{renderInline(n.children)}</strong>;
      case "code":
        return (
          <code key={i} className="break-words rounded bg-zinc-100 px-1 py-0.5 text-[0.9em]">
            {n.text}
          </code>
        );
      case "link": {
        const external = n.href.startsWith("https:");
        return (
          <a
            key={i}
            href={n.href}
            className="text-zinc-900 underline underline-offset-2"
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            {renderInline(n.children)}
          </a>
        );
      }
    }
  });
}

function renderBlock(b: BlockNode, key: number): ReactNode {
  switch (b.type) {
    case "heading": {
      const cls = {
        1: "mt-2 text-2xl font-semibold",
        2: "mt-6 text-lg font-semibold",
        3: "mt-4 text-base font-semibold",
      }[b.level];
      const children = renderInline(b.children);
      if (b.level === 1)
        return (
          <h1 key={key} className={cls}>
            {children}
          </h1>
        );
      if (b.level === 2)
        return (
          <h2 key={key} className={cls}>
            {children}
          </h2>
        );
      return (
        <h3 key={key} className={cls}>
          {children}
        </h3>
      );
    }
    case "quote":
      return (
        <blockquote key={key} className="mt-3 border-l-4 border-zinc-300 pl-3 text-zinc-700">
          {renderInline(b.children)}
        </blockquote>
      );
    case "paragraph":
      return (
        <p key={key} className="mt-3 leading-relaxed">
          {renderInline(b.children)}
        </p>
      );
    case "list": {
      const items = b.items.map((it, i) => <li key={i}>{renderInline(it)}</li>);
      return b.ordered ? (
        <ol key={key} className="mt-3 list-decimal space-y-1 pl-6">
          {items}
        </ol>
      ) : (
        <ul key={key} className="mt-3 list-disc space-y-1 pl-6">
          {items}
        </ul>
      );
    }
    case "table":
      return (
        <div key={key} className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>
                {b.header.map((c, i) => (
                  <th key={i} className="border-b border-zinc-300 px-2 py-1 font-semibold">
                    {renderInline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} className="border-b border-zinc-200 px-2 py-1 align-top">
                      {renderInline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function renderLegalBlocks(blocks: BlockNode[]): ReactNode[] {
  return blocks.map(renderBlock);
}

/** Fecha de última actualización: del frontmatter (`actualizado` o `updated`), si existe. */
export function legalUpdatedAt(doc: LegalDocument): string | null {
  return doc.meta.actualizado ?? doc.meta.updated ?? null;
}

/** Página común de /privacidad y /terminos: aviso de borrador + texto. Server Component. */
export function LegalPage({ name }: { name: LegalName }) {
  const doc = loadFilledLegalDocument(name);
  const updated = legalUpdatedAt(doc);
  return (
    <article className="mx-auto max-w-prose break-words text-sm sm:text-base">
      <p
        role="note"
        className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
      >
        <strong>Borrador en revisión:</strong> todavía no vigente.
      </p>
      {updated ? (
        <p className="mt-2 text-xs text-zinc-500">Última actualización: {updated}</p>
      ) : null}
      {renderLegalBlocks(doc.blocks)}
    </article>
  );
}
