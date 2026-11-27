import { describe, expect, it } from "vitest";
import { cvOfferFileName, reorderCvBullets } from "./cv-offer-download";
import type { CvDocument } from "./cv-out/model";

describe("cvOfferFileName", () => {
  it("arma CV-puesto-empresa.docx sin tildes ni caracteres raros", () => {
    expect(cvOfferFileName("Desarrolladora Sénior (Remoto)", "Empresa A S.A.")).toBe(
      "CV-Desarrolladora-Senior-Remoto-Empresa-A-S-A.docx",
    );
  });

  it("sanea separadores de ruta, comillas, saltos de línea y emojis", () => {
    const n = cvOfferFileName('../../etc/passwd"\r\nX', "Empresa 🚀 B");
    expect(n).toMatch(/^CV-[A-Za-z0-9-]+\.docx$/);
    expect(n).not.toContain("..");
  });

  it("acota el largo de cada parte", () => {
    const n = cvOfferFileName("a".repeat(500), "b".repeat(500));
    expect(n.length).toBeLessThanOrEqual(3 + 1 + 40 + 1 + 40 + 5);
  });

  it("cae en CV.docx si no queda nada", () => {
    expect(cvOfferFileName("¿¿??", "")).toBe("CV.docx");
  });

  it("omite la parte vacía", () => {
    expect(cvOfferFileName("Analista", "***")).toBe("CV-Analista.docx");
  });

  it("sirve para PDF y marca la versión adaptada (R34-02)", () => {
    expect(cvOfferFileName("Analista", "Empresa A", "pdf")).toBe("CV-Analista-Empresa-A.pdf");
    expect(cvOfferFileName("Analista", "Empresa A", "docx", true)).toBe(
      "CV-Analista-Empresa-A-adaptado.docx",
    );
    expect(cvOfferFileName("¿¿??", "", "pdf", true)).toBe("CV-adaptado.pdf");
  });

  it("2 MB de texto en menos de 100 ms", () => {
    const t0 = performance.now();
    cvOfferFileName("x ".repeat(1024 * 1024), "y ".repeat(1024 * 1024));
    expect(performance.now() - t0).toBeLessThan(100);
  });
});

const doc = (): CvDocument => ({
  lang: "es",
  name: "Persona A",
  headline: null,
  contact: [],
  missing: [],
  sections: [
    {
      id: "experience",
      title: "Experiencia",
      blocks: [
        {
          heading: "Analista",
          detail: "Empresa A",
          bullets: ["Armé reportes", "Usé Docker", "Escribí TypeScript y Docker", "Coordiné"],
        },
      ],
    },
    {
      id: "skills",
      title: "Skills",
      blocks: [{ heading: null, detail: "Docker, TypeScript", bullets: [] }],
    },
  ],
});

describe("reorderCvBullets", () => {
  const skills = [
    { name: "TypeScript", isMust: true },
    { name: "Docker", isMust: false },
  ];

  it("reordena las viñetas de cada bloque, estable, sin cambiar su texto", () => {
    const out = reorderCvBullets(doc(), skills);
    expect(out.sections[0]!.blocks[0]!.bullets).toEqual([
      "Escribí TypeScript y Docker",
      "Usé Docker",
      "Armé reportes",
      "Coordiné",
    ]);
  });

  it("no muta el original ni toca el resto del documento", () => {
    const d = doc();
    const out = reorderCvBullets(d, skills);
    expect(d.sections[0]!.blocks[0]!.bullets[0]).toBe("Armé reportes");
    expect(out.sections[1]).toEqual(d.sections[1]);
    expect(out.name).toBe(d.name);
  });

  it("sin skills devuelve el mismo orden", () => {
    const out = reorderCvBullets(doc(), []);
    expect(out.sections[0]!.blocks[0]!.bullets).toEqual(doc().sections[0]!.blocks[0]!.bullets);
  });
});
