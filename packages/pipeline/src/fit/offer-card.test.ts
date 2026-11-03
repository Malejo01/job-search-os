import { describe, expect, it } from "vitest";
import { offerAge, offerCardChips, offerPlace } from "./offer-card";

describe("offerCardChips (tarjeta K2, C9-8)", () => {
  it("con checklist: verdes y ámbar, como mucho 3, «y N más» y la línea de conteo", () => {
    const r = offerCardChips({
      checklist: {
        have: ["Liquidación de sueldos", "Excel", "3 años", "Inglés"],
        missing: ["Tango Gestión"],
        haveCount: 4,
        missingCount: 1,
      },
      strengths: ["no se usa"],
      gaps: ["no se usa"],
    });
    expect(r.chips).toEqual([
      { tone: "have", label: "Liquidación de sueldos" },
      { tone: "have", label: "Excel" },
      { tone: "missing", label: "Tango Gestión" },
    ]);
    expect(r.more).toBe(2);
    expect(r.count).toBe("4 a tu favor, 1 te falta");
  });

  it("plural y casos sin un lado", () => {
    const base = { strengths: [], gaps: [] };
    expect(
      offerCardChips({
        ...base,
        checklist: { have: [], missing: ["A", "B"], haveCount: 0, missingCount: 2 },
      }).count,
    ).toBe("2 te faltan");
    expect(
      offerCardChips({
        ...base,
        checklist: { have: ["A"], missing: [], haveCount: 1, missingCount: 0 },
      }).count,
    ).toBe("1 a tu favor");
    expect(
      offerCardChips({
        ...base,
        checklist: { have: [], missing: [], haveCount: 0, missingCount: 0 },
      }).count,
    ).toBeNull();
  });

  it("sin faltantes, hasta 3 verdes", () => {
    const r = offerCardChips({
      checklist: { have: ["A", "B", "C", "D"], missing: [], haveCount: 5, missingCount: 0 },
      strengths: [],
      gaps: [],
    });
    expect(r.chips.map((c) => c.label)).toEqual(["A", "B", "C"]);
    expect(r.more).toBe(2);
  });

  it("solo faltantes: hasta 3 ámbar", () => {
    const r = offerCardChips({
      checklist: { have: [], missing: ["A", "B", "C", "D"], haveCount: 0, missingCount: 4 },
      strengths: [],
      gaps: [],
    });
    expect(r.chips.every((c) => c.tone === "missing")).toBe(true);
    expect(r.chips).toHaveLength(3);
    expect(r.more).toBe(1);
  });

  it("sin checklist: fortalezas y debilidades de la evaluación, sin conteo", () => {
    const r = offerCardChips({
      checklist: null,
      strengths: ["Experiencia en sueldos", "Manejo de Excel"],
      gaps: ["No menciona Tango", "Sin inglés", "Otra"],
    });
    expect(r.chips).toEqual([
      { tone: "have", label: "Experiencia en sueldos" },
      { tone: "have", label: "Manejo de Excel" },
      { tone: "missing", label: "No menciona Tango" },
    ]);
    expect(r.more).toBe(2);
    expect(r.count).toBeNull();
  });

  it("descarta textos vacíos y corta los largos", () => {
    const long = "x".repeat(200);
    const r = offerCardChips({ checklist: null, strengths: ["  ", long], gaps: [] });
    expect(r.chips).toHaveLength(1);
    expect(r.chips[0]!.label.length).toBeLessThanOrEqual(60);
    expect(r.chips[0]!.label.endsWith("…")).toBe(true);
  });
});

describe("offerPlace: empresa y lugar en una frase, sin «·»", () => {
  it("presencial o híbrido con lugar", () => {
    expect(
      offerPlace({
        company: "Estudio Ruiz y Asociados",
        location: "Salta",
        modality: "presencial",
      }),
    ).toBe("Estudio Ruiz y Asociados, en Salta");
    expect(offerPlace({ company: "Grupo Norte", location: "Córdoba", modality: null })).toBe(
      "Grupo Norte, en Córdoba",
    );
  });

  it("remoto, con o sin país", () => {
    expect(offerPlace({ company: "Grupo Norte", location: "Argentina", modality: "remoto" })).toBe(
      "Grupo Norte, remoto en Argentina",
    );
    expect(offerPlace({ company: "Grupo Norte", location: "Remote", modality: "remoto" })).toBe(
      "Grupo Norte, remoto",
    );
    expect(offerPlace({ company: "Grupo Norte", location: null, modality: "remoto" })).toBe(
      "Grupo Norte, remoto",
    );
  });

  it("sin lugar ni modalidad, la empresa sola", () => {
    expect(offerPlace({ company: "Grupo Norte", location: null, modality: "desconocida" })).toBe(
      "Grupo Norte",
    );
    expect(offerPlace({ company: "Grupo Norte", location: "  ", modality: null })).toBe(
      "Grupo Norte",
    );
  });
});

describe("offerAge: antigüedad del aviso", () => {
  const now = new Date("2026-11-03T15:00:00Z");
  it("hoy, ayer, días, semanas y más de un mes", () => {
    expect(offerAge(new Date("2026-11-03T10:00:00Z"), now)).toBe("Publicada hoy");
    expect(offerAge(new Date("2026-11-02T10:00:00Z"), now)).toBe("Publicada ayer");
    expect(offerAge(new Date("2026-10-30T10:00:00Z"), now)).toBe("Publicada hace 4 días");
    expect(offerAge(new Date("2026-10-20T10:00:00Z"), now)).toBe("Publicada hace 2 semanas");
    expect(offerAge(new Date("2026-09-01T10:00:00Z"), now)).toBe("Publicada hace más de un mes");
  });
  it("una fecha futura cuenta como hoy", () => {
    expect(offerAge(new Date("2026-11-05T10:00:00Z"), now)).toBe("Publicada hoy");
  });
});
