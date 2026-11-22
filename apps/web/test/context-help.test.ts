import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFicha, pickApproved } from "../lib/academy";

const WEB = join(__dirname, "..");
const raw = (slug: string, estado: string) =>
  parseFicha(
    slug,
    `---\ntitulo: Ficha ${slug}\nestado: ${estado}\norden: 1\n---\nTexto de la ficha.\n\n- Un punto.`,
  )!;

describe("«?» contextual: cuándo aparece", () => {
  const fichas = [
    raw("palabras-clave", "aprobada"),
    raw("filtro-ats", "borrador"),
    raw("seniority", "publicada"),
  ];

  it("con la ficha aprobada hay ficha, y el ícono se dibuja", () => {
    expect(pickApproved(fichas, "palabras-clave")?.titulo).toBe("Ficha palabras-clave");
  });

  it("con la ficha en borrador, o con un estado raro, no hay ficha: el ícono no aparece", () => {
    expect(pickApproved(fichas, "filtro-ats")).toBeNull();
    expect(pickApproved(fichas, "seniority")).toBeNull();
  });

  it("una ficha que no existe no aparece", () => {
    expect(pickApproved(fichas, "no-existe")).toBeNull();
  });
});

describe("«?» contextual: el componente", () => {
  const src = readFileSync(join(WEB, "components/context-help.tsx"), "utf8");

  it("es un <details> nativo (teclado y lector de pantalla), con nombre accesible y enlace a Academy", () => {
    expect(src).toContain("<details");
    expect(src).toContain("<summary");
    expect(src).toMatch(/sr-only">Qué es: \{term\}/);
    expect(src).toContain("min-h-11 min-w-11");
    expect(src).toContain("focus-visible:outline");
    expect(src).toContain("/academy/${ficha.slug}");
  });

  it("no dibuja nada si la ficha no está aprobada y no inyecta HTML", () => {
    expect(src).toMatch(/if \(ficha\.estado !== "aprobada"\) return null/);
    expect(src).toMatch(/if \(!ficha\) return null/);
    expect(src).not.toMatch(/dangerouslySetInnerHTML/);
  });

  it("el detalle de la oferta lo usa en condiciones y transparencia", () => {
    const c = readFileSync(join(WEB, "app/(app)/jobs/[id]/conditions-block.tsx"), "utf8");
    for (const slug of ["seniority", "presencial-hibrido-remoto", "rango-salarial"])
      expect(c).toContain(`slug: "${slug}"`);
    const t = readFileSync(join(WEB, "app/(app)/jobs/[id]/transparency-block.tsx"), "utf8");
    expect(t).toContain('slug="transparencia-del-aviso"');
  });

  it("la pantalla de CV lo usa para el filtro ATS y las palabras clave", () => {
    const d = readFileSync(join(WEB, "components/cv-coach/items-diagnosis.tsx"), "utf8");
    expect(d).toContain('slug="filtro-ats"');
    expect(d).toContain('slug="palabras-clave"');
  });
});
