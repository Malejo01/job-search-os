import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { aplanarTextos, textosRediseno } from "../lib/textos-aprobacion";

const WEB = join(__dirname, "..");
const src = (f: string) => readFileSync(join(WEB, f), "utf8");

describe("aplanarTextos (R26-02)", () => {
  const lista = aplanarTextos({
    PALABRAS: { alto: "Te calza", medio: "Cerca" },
    PASOS: { steps: [{ id: "uno", title: "Primero", text: "Texto 1" }] },
    SUELTO: "Hola",
    NUMERO: 3,
    VACIO: "",
    AYUDA: { x: { slug: "una-ficha", term: "término" } },
  });

  it("una hoja de texto por clave, con la ruta como clave y el nombre de la constante como grupo", () => {
    expect(lista.map((t) => [t.clave, t.grupo, t.valor])).toEqual([
      ["AYUDA.x.term", "AYUDA", "término"],
      ["PALABRAS.alto", "PALABRAS", "Te calza"],
      ["PALABRAS.medio", "PALABRAS", "Cerca"],
      ["PASOS.steps.0.text", "PASOS", "Texto 1"],
      ["PASOS.steps.0.title", "PASOS", "Primero"],
      ["SUELTO", "SUELTO", "Hola"],
    ]);
  });

  it("omite identificadores (id, slug), números y textos vacíos", () => {
    const claves = lista.map((t) => t.clave);
    expect(claves).not.toContain("PASOS.steps.0.id");
    expect(claves).not.toContain("AYUDA.x.slug");
    expect(claves).not.toContain("NUMERO");
    expect(claves).not.toContain("VACIO");
  });

  it("la huella es el sha256 del texto: cambia si cambia el texto", () => {
    const a = aplanarTextos({ T: { uno: "Hola" } })[0]!;
    const b = aplanarTextos({ T: { uno: "Hola." } })[0]!;
    expect(a.huella).toMatch(/^[0-9a-f]{64}$/);
    expect(a.huella).not.toBe(b.huella);
    expect(aplanarTextos({ T: { uno: "Hola" } })[0]!.huella).toBe(a.huella);
  });
});

describe("los textos reales del rediseño", () => {
  const textos = textosRediseno();

  it("hay textos, con claves únicas y válidas para la base", () => {
    expect(textos.length).toBeGreaterThan(30);
    const claves = textos.map((t) => t.clave);
    expect(new Set(claves).size).toBe(claves.length);
    for (const c of claves) {
      expect(c, c).toMatch(/^[A-Za-z0-9_.-]+$/);
      expect(c.length, c).toBeLessThanOrEqual(120);
    }
  });

  it("incluye las palabras de las barras y los pasos del primer uso", () => {
    const claves = new Set(textos.map((t) => t.clave));
    for (const c of ["AFFINITY_WORDS.high", "TRANSPARENCY_WORDS.clear", "PRIMER_USO.steps.0.title"])
      expect(claves.has(c), c).toBe(true);
  });
});

describe("la acción y las pantallas de textos", () => {
  const action = src("app/(app)/settings/textos/actions.ts");

  it("comprueba el permiso antes de leer o escribir nada", () => {
    const guard = action.indexOf("canReviewAcademy(userId)");
    expect(guard).toBeGreaterThan(-1);
    expect(action.indexOf("notFound()")).toBeGreaterThan(guard);
    expect(action.indexOf("textosRediseno()")).toBeGreaterThan(guard);
    expect(action.indexOf("addTextReview(")).toBeGreaterThan(guard);
  });

  it("la huella y la clave salen del servidor; una propuesta nunca toca la app", () => {
    expect(action).toContain("huella: texto.huella");
    expect(action).not.toMatch(/formData\.get\(["'](huella|hash)["']\)/);
    // Solo guarda: no escribe archivos ni cambia nada de textos-rediseno
    expect(action).not.toMatch(/writeFile|appendFile|fs\//);
  });

  it("/settings/textos da 404 a quien no revisa antes de leer la base", () => {
    const page = src("app/(app)/settings/textos/page.tsx");
    const guard = page.indexOf("canReviewAcademy(userId)");
    expect(guard).toBeGreaterThan(-1);
    expect(page.indexOf("notFound()")).toBeGreaterThan(guard);
    expect(page.indexOf("textReviewLatest(")).toBeGreaterThan(guard);
  });

  it("/admin/textos muestra «Propuestas de Ani» con «Copiar» y usa la acción compartida", () => {
    const page = src("app/(app)/admin/textos/page.tsx");
    expect(page).toContain("CopyButton");
    expect(page).toContain("propuestasTitulo");
    expect(page).toContain("reviewTextoAction");
    expect(page.indexOf("requireAdminOr404(userId)")).toBeLessThan(
      page.indexOf("textReviewLatest("),
    );
  });

  it("el botón Copiar es un cliente chico, sin dependencias ni Framer", () => {
    const copy = src("components/copy-button.tsx");
    expect(copy.startsWith('"use client"')).toBe(true);
    expect(copy).not.toMatch(/framer-motion/);
    expect(copy).toContain("navigator.clipboard.writeText");
  });

  it("la checklist de apertura cuenta desde la base, no desde una lista a mano", () => {
    const apertura = src("lib/apertura.ts");
    expect(apertura).toContain("text_reviews");
    expect(apertura).toContain("contarTextosAprobados(");
    expect(apertura).not.toMatch(/export const TEXTOS_REDISENO_APROBADOS/);
  });

  it("la base: lectura solo para quien revisa y escritura con la barrera", () => {
    const sql = readFileSync(
      join(WEB, "..", "..", "packages", "db", "rls", "0066_text_reviews.sql"),
      "utf8",
    );
    expect(sql.match(/NOT public\.can_review_content\(\)/g)?.length).toBe(3);
    expect(sql).toContain('REVOKE ALL ON "text_reviews" FROM authenticated');
  });
});
