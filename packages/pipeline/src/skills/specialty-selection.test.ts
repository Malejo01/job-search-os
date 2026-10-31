import { describe, expect, it } from "vitest";
import {
  jobMatchesSpecialties,
  MAX_SPECIALTY_ENTRIES,
  normalizeTargetSpecialties,
  parseSpecialtyEntries,
  selectedSpecialtyIds,
} from "./specialty-selection";
import { specialtiesFor } from "./specialties";

const FIN = specialtiesFor("finanzas_contabilidad").map((c) => c.id);
const ABO = specialtiesFor("abogacia").map((c) => c.id);

describe("parseSpecialtyEntries · lo que manda el formulario", () => {
  it("agrupa los «carrera:área» por carrera, sin repetir", () => {
    expect(
      parseSpecialtyEntries([
        "finanzas_contabilidad:sueldos",
        "finanzas_contabilidad:impuestos",
        "finanzas_contabilidad:sueldos",
        "abogacia:laboral",
      ]),
    ).toEqual({
      finanzas_contabilidad: ["sueldos", "impuestos"],
      abogacia: ["laboral"],
    });
  });

  it("ignora lo que no tiene forma de «carrera:área» o no es texto", () => {
    expect(parseSpecialtyEntries(["sueldos", ":x", "x:", 3, null, {}, "a:b:c", ""])).toEqual({});
    expect(parseSpecialtyEntries(undefined)).toEqual({});
  });

  it("corta en el tope de entradas: un envío armado a mano no crece sin límite", () => {
    const many = Array.from(
      { length: MAX_SPECIALTY_ENTRIES + 50 },
      (_, i) => `finanzas_contabilidad:a${i}`,
    );
    const parsed = parseSpecialtyEntries(many);
    expect(Object.values(parsed).flat().length).toBe(MAX_SPECIALTY_ENTRIES);
  });
});

describe("normalizeTargetSpecialties · qué se guarda", () => {
  const roles = ["finanzas_contabilidad", "abogacia"] as const;

  it("«Todas las áreas» no restringe nada: se guarda null", () => {
    expect(normalizeTargetSpecialties({}, roles)).toBeNull();
    expect(normalizeTargetSpecialties(null, roles)).toBeNull();
    expect(normalizeTargetSpecialties(undefined, roles)).toBeNull();
    // Todas las áreas marcadas es lo mismo que ninguna restricción
    expect(
      normalizeTargetSpecialties({ finanzas_contabilidad: FIN, abogacia: ABO }, roles),
    ).toBeNull();
  });

  it("guarda solo las carreras que se acotaron, en el orden del catálogo", () => {
    expect(
      normalizeTargetSpecialties({ finanzas_contabilidad: ["sueldos", "impuestos"] }, roles),
    ).toEqual({
      finanzas_contabilidad: FIN.filter((id) => id === "impuestos" || id === "sueldos"),
    });
  });

  it("descarta áreas que no existen, carreras sin áreas y carreras que la persona no eligió", () => {
    expect(
      normalizeTargetSpecialties(
        {
          finanzas_contabilidad: ["sueldos", "inventada"],
          backend: ["x"],
          marketing_digital: ["seo_y_contenidos"],
          inventada: ["x"],
        },
        ["finanzas_contabilidad", "backend"],
      ),
    ).toEqual({ finanzas_contabilidad: ["sueldos"] });
  });

  it("una carrera con todas las áreas inválidas vuelve a «todas» y no se guarda", () => {
    expect(normalizeTargetSpecialties({ finanzas_contabilidad: ["inventada"] }, roles)).toBeNull();
    expect(normalizeTargetSpecialties({ finanzas_contabilidad: [] }, roles)).toBeNull();
  });

  it("si la persona saca una carrera, sus áreas se van con ella", () => {
    expect(
      normalizeTargetSpecialties({ finanzas_contabilidad: ["sueldos"], abogacia: ["laboral"] }, [
        "abogacia",
      ]),
    ).toEqual({ abogacia: ["laboral"] });
  });

  it("falla cerrado ante un valor que no es un objeto: queda en «todas»", () => {
    for (const bad of ["sueldos", 3, true, ["sueldos"], [["a"]]]) {
      expect(normalizeTargetSpecialties(bad, roles)).toBeNull();
    }
    // Una carrera con un valor que no es lista tampoco rompe nada
    expect(normalizeTargetSpecialties({ finanzas_contabilidad: "sueldos" }, roles)).toBeNull();
  });

  it("acepta lo que devuelve parseSpecialtyEntries de punta a punta", () => {
    const fromForm = parseSpecialtyEntries(["abogacia:laboral", "abogacia:penal"]);
    expect(normalizeTargetSpecialties(fromForm, roles)).toEqual({
      abogacia: ["laboral", "penal"],
    });
  });
});

describe("selectedSpecialtyIds · lo que marca la pantalla", () => {
  it("null = todas las áreas", () => {
    expect(selectedSpecialtyIds(null, "finanzas_contabilidad")).toBeNull();
    expect(selectedSpecialtyIds({ abogacia: ["laboral"] }, "finanzas_contabilidad")).toBeNull();
  });

  it("devuelve las áreas guardadas, filtrando las que ya no existen en el catálogo", () => {
    expect(
      selectedSpecialtyIds(
        { finanzas_contabilidad: ["sueldos", "quitada_del_catalogo"] },
        "finanzas_contabilidad",
      ),
    ).toEqual(["sueldos"]);
    // Si ninguna sigue existiendo, vuelve a «todas»
    expect(
      selectedSpecialtyIds(
        { finanzas_contabilidad: ["quitada_del_catalogo"] },
        "finanzas_contabilidad",
      ),
    ).toBeNull();
  });
});

describe("jobMatchesSpecialties · referencia para filtrar avisos (todavía no se usa)", () => {
  const sel = { finanzas_contabilidad: ["sueldos"] };

  it("sin selección para la carrera, todo pasa", () => {
    expect(jobMatchesSpecialties("Analista Impositivo", "finanzas_contabilidad", null)).toBe(true);
    expect(jobMatchesSpecialties("Analista Impositivo", "abogacia", sel)).toBe(true);
  });

  it("con selección, pasa un aviso de un área elegida y no uno de otra área", () => {
    expect(jobMatchesSpecialties("Analista de Sueldos Sr", "finanzas_contabilidad", sel)).toBe(
      true,
    );
    expect(jobMatchesSpecialties("Tax Analyst", "finanzas_contabilidad", sel)).toBe(false);
  });

  it("un título que ningún área nombra nunca se esconde", () => {
    expect(
      jobMatchesSpecialties("Responsable de Área Financiera", "finanzas_contabilidad", sel),
    ).toBe(true);
  });

  it("si el título nombra un área elegida y otra que no, pasa", () => {
    expect(jobMatchesSpecialties("Payroll & Tax Analyst", "finanzas_contabilidad", sel)).toBe(true);
  });
});
