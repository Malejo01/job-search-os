import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BRAND, BRAND_COLORS, COPYRIGHT_NOTICE } from "./brand";
import { PRODUCT_NAME } from "./product";

/**
 * C6-2: el nombre del producto vive en `brand.ts`. Ningún otro archivo de código lo escribe a mano
 * (UI, emails, metadata, User-Agent): cambiar de nombre es editar `BRAND.name`. Quedan afuera los
 * textos legales (carril rojo, los revisa Mauro), los tests, los e2e y las fixtures.
 */
const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const SCAN_DIRS = ["apps/web/app", "apps/web/components", "apps/web/lib", "packages"];
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "e2e",
  "__fixtures__",
  "fixtures",
  "legal",
]);
const EXT = /\.(ts|tsx|mjs|json)$/;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (EXT.test(name) && !/\.test\.tsx?$/.test(name)) yield full;
  }
}

describe("marca en un solo lugar", () => {
  it("PRODUCT_NAME sale de BRAND.name", () => {
    expect(PRODUCT_NAME).toBe(BRAND.name);
  });

  it("el aviso de derechos reservados sale de BRAND.name y dice lo pedido, sin más", () => {
    expect(COPYRIGHT_NOTICE).toBe("© 2026 AfinIAJobs. Todos los derechos reservados.");
  });

  it.each(["terminos.md", "privacidad.md"])(
    "%s lleva el aviso de derechos reservados y la marca de revisión con Camila",
    (file) => {
      const text = readFileSync(join(ROOT, "apps/web/content/legal", file), "utf8");
      expect(text).toContain(COPYRIGHT_NOTICE);
      expect(text).toContain(
        "[REVISAR CON CAMILA (abogada): protección de marca / derecho de autor]",
      );
    },
  );

  it("ningún archivo de código, salvo brand.ts, escribe el nombre a mano", () => {
    const names = [BRAND.name, BRAND.name.replace(/\s+/g, "")];
    const offenders: string[] = [];
    for (const d of SCAN_DIRS) {
      for (const file of walk(join(ROOT, d))) {
        const rel = relative(ROOT, file).split(sep).join("/");
        if (rel === "packages/pipeline/src/brand.ts") continue;
        // Las seeds de ejemplo son datos de muestra, no UI
        if (rel.startsWith("packages/db/seeds/")) continue;
        const text = readFileSync(file, "utf8");
        for (const n of names) if (text.includes(n)) offenders.push(`${rel}: «${n}»`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * C7-2: el nombre se escribe «AfinIAJobs» en todas partes. Falla si en el código o el contenido de
 * la app (UI, emails, metadata, manifest, textos) queda el nombre viejo o una variante mal escrita
 * («afiniajobs», «AfiniaJobs», «Afinia Jobs»…). Se permiten las URLs, los dominios y los emails
 * (`afiniajobs.com.ar`) y la clave técnica `job-search-os` (paquetes, MCP, repo).
 */
const NAME_SCAN_DIRS = [
  "apps/web/app",
  "apps/web/components",
  "apps/web/lib",
  "apps/web/content",
  "packages/pipeline/src",
  "packages/adapters/src",
];
const NAME_EXT = /\.(ts|tsx|mjs|json|md|svg)$/;
// Incluye los legales desde C7-3
const NAME_SKIP = new Set(["node_modules", ".next", "dist", "e2e", "__fixtures__", "fixtures"]);

function* walkNames(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (NAME_SKIP.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walkNames(full);
    else if (NAME_EXT.test(name) && !/\.test\.tsx?$/.test(name)) yield full;
  }
}

/** Saca URLs, emails y dominios: ahí el nombre va en minúsculas y está bien. */
function withoutAddresses(text: string): string {
  return text
    .replace(/https?:\/\/[^\s"'`)<>]+/g, " ")
    .replace(/[\w.+-]+@[\w.-]+/g, " ")
    .replace(/\b[\w-]*afinia-?jobs\.[a-z.]+/gi, " ");
}

export function brandNameProblems(text: string): string[] {
  const clean = withoutAddresses(text);
  const problems: string[] = [];
  for (const m of clean.matchAll(/job\s*search\s*os/gi)) problems.push(m[0]);
  for (const m of clean.matchAll(/afinia[\s_-]*jobs/gi))
    if (m[0] !== BRAND.name) problems.push(m[0]);
  return problems;
}

describe("nombre AfinIAJobs bien escrito (C7-2)", () => {
  it("el nombre es AfinIAJobs", () => {
    expect(BRAND.name).toBe("AfinIA" + "Jobs");
  });

  it("detecta las variantes y deja pasar URLs, dominios y la clave técnica", () => {
    expect(brandNameProblems("Bienvenida a afiniajobs")).toEqual(["afiniajobs"]);
    expect(brandNameProblems("AfiniaJobs y Afinia Jobs")).toEqual(["AfiniaJobs", "Afinia Jobs"]);
    expect(brandNameProblems("Job Search OS")).toEqual(["Job Search OS"]);
    expect(brandNameProblems("https://afiniajobs.com.ar/acceso")).toEqual([]);
    expect(brandNameProblems("hola@afiniajobs.com.ar")).toEqual([]);
    expect(brandNameProblems("app.afiniajobs.com.ar")).toEqual([]);
    expect(brandNameProblems('serverInfo: { name: "job-search-os" }')).toEqual([]);
  });

  it("ningún texto de la app escribe mal el nombre", () => {
    const offenders: string[] = [];
    for (const d of NAME_SCAN_DIRS) {
      for (const file of walkNames(join(ROOT, d))) {
        const rel = relative(ROOT, file).split(sep).join("/");
        for (const p of brandNameProblems(readFileSync(file, "utf8")))
          offenders.push(`${rel}: «${p}»`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("BRAND_COLORS coincide con los tokens de globals.css", () => {
    const css = readFileSync(join(ROOT, "apps/web/app/globals.css"), "utf8").toLowerCase();
    // El bloque de claro empieza en «:root,» (lo comparte con `.light`)
    const start = css.indexOf(":root,");
    const root = css.slice(start, css.indexOf("\n}", start));
    expect(root).toContain(`--jso-ink: ${BRAND_COLORS.ink.toLowerCase()};`);
    expect(root).toContain(`--jso-brand: ${BRAND_COLORS.accent.toLowerCase()};`);
    expect(root).toContain(`--jso-brand-text: ${BRAND_COLORS.accentDeep.toLowerCase()};`);
    expect(root).toContain(`--jso-canvas: ${BRAND_COLORS.canvas.toLowerCase()};`);
    expect(root).toContain(`--jso-edge-brand: ${BRAND_COLORS.accentEdge.toLowerCase()};`);
    expect(root).toContain(`--jso-fg-subtle: ${BRAND_COLORS.textMuted.toLowerCase()};`);
  });
});
