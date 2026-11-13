import { describe, expect, it } from "vitest";
import { joinLabels, nudgeCopy } from "./nudge-copy";
import { GUIDE_PORTALS, portalGroupsForRoles, portalListText } from "./portal-guide";

describe("joinLabels", () => {
  it("une con coma y «y»", () => {
    expect(joinLabels([])).toBe("");
    expect(joinLabels(["Abogacía"])).toBe("Abogacía");
    expect(joinLabels(["Abogacía", "Comunicación"])).toBe("Abogacía y Comunicación");
    expect(joinLabels(["A", "B", "C"])).toBe("A, B y C");
  });
});

describe("nudgeCopy", () => {
  it("sin pocas ofertas: el aviso de siempre, con los portales de la carrera", () => {
    const copy = nudgeCopy({ roles: ["abogacia"], language: "es", few: [] });
    expect(copy.title).toBe("Sumá tus alertas de LinkedIn e Indeed");
    expect(copy.body).toContain("Reenviá las alertas que ya te llegan");
    expect(copy.body).toContain("Bumeran y ZonaJobs");
    expect(copy.body).toContain("pegá el aviso");
    expect(copy.cta).toBe("Conectar mis alertas");
    expect(copy.secondary).toBeNull();
  });

  it("para tecnología nombra también Get on Board", () => {
    expect(nudgeCopy({ roles: ["fullstack"], language: "es", few: [] }).title).toBe(
      "Sumá tus alertas de LinkedIn, Indeed y Get on Board",
    );
  });

  it("nunca nombra Computrabajo mientras no se recomiende", () => {
    for (const roles of [[], ["fullstack"], ["abogacia"]]) {
      const copy = nudgeCopy({ roles, language: "es", few: ["Abogacía"] });
      expect(`${copy.title} ${copy.body}`).not.toContain("Computrabajo");
      expect(nudgeCopy({ roles, language: "es", few: [] }).body).not.toContain("Computrabajo");
    }
  });

  it("con pocas ofertas en el idioma: lo dice y ofrece cargar ofertas y las alertas, en un solo mensaje", () => {
    const copy = nudgeCopy({
      roles: ["abogacia", "comunicacion"],
      language: "es",
      few: ["Abogacía", "Comunicación"],
    });
    expect(copy.title).toBe("Hay pocas ofertas de Abogacía y Comunicación en español esta semana");
    expect(copy.body).toContain("menos de 5");
    expect(copy.cta).toBe("Conectar mis alertas");
    expect(copy.secondary).toEqual({
      label: "Cargar una oferta (texto o imagen)",
      href: "/jobs/new",
    });
  });

  it("la lista de portales es la de la guía, la misma fuente", () => {
    for (const roles of [[], ["fullstack"], ["abogacia"], ["finanzas_contabilidad"]]) {
      const g = portalGroupsForRoles(roles);
      const copy = nudgeCopy({ roles, language: "es", few: [] });
      expect(copy.title).toBe(`Sumá tus alertas de ${portalListText(g.automatic)}`);
      if (g.manual.length) expect(copy.body).toContain(portalListText(g.manual));
    }
    expect(GUIDE_PORTALS.length).toBeGreaterThan(0);
  });

  it("el idioma sale en el mensaje de pocas ofertas", () => {
    const en = nudgeCopy({ roles: ["abogacia"], language: "en", few: ["Abogacía"] });
    expect(en.title).toContain("en inglés");
    const both = nudgeCopy({ roles: ["abogacia"], language: "both", few: ["Abogacía"] });
    expect(both.title).toContain("en español e inglés");
  });
});
