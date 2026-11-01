import { describe, expect, it } from "vitest";
import { TITLE_TERMS } from "./role-hints";
import { ROLE_KEYS, type RoleKey } from "./self-assessment";
import {
  ROLE_SPECIALTIES,
  specialtiesFor,
  specialtyIdsForTitle,
  termsForSpecialties,
} from "./specialties";

const roles = Object.keys(ROLE_SPECIALTIES) as RoleKey[];

it("cubre al menos las dos carreras que se amplían", () => {
  expect(roles).toEqual(expect.arrayContaining(["finanzas_contabilidad", "marketing_digital"]));
});

describe("ROLE_SPECIALTIES · las seis carreras de la beta", () => {
  it.each([
    ["finanzas_contabilidad", 10],
    ["abogacia", 11],
    ["administracion_empresas", 10],
    ["comunicacion", 9],
    ["marketing_digital", 11],
    ["relaciones_internacionales", 8],
  ] as [RoleKey, number][])("%s tiene %i chips", (role, n) => {
    expect(specialtiesFor(role)).toHaveLength(n);
  });

  it("los rótulos son los del spec", () => {
    expect(specialtiesFor("abogacia").map((c) => c.label)).toEqual([
      "Empresas y contratos",
      "Laboral",
      "Impuestos",
      "Juicios y tribunales",
      "Penal",
      "Familia y sucesiones",
      "Cumplimiento y prevención de lavado",
      "Marcas, patentes y datos personales",
      "Sector público",
      "Inmobiliario y registral",
      "Internacional e inmigración",
    ]);
    expect(specialtiesFor("relaciones_internacionales").map((c) => c.label)).toEqual([
      "Comercio exterior",
      "Cooperación internacional y ONG",
      "Organismos internacionales",
      "Relaciones institucionales y asuntos públicos",
      "Análisis político y riesgo",
      "Integración y negociaciones",
      "Migraciones y movilidad",
      "Diplomacia",
    ]);
  });
});

describe("ROLE_SPECIALTIES · forma", () => {
  it("solo tiene claves de ROLE_KEYS", () => {
    for (const role of roles) expect(ROLE_KEYS).toContain(role);
  });

  it.each(roles)("%s: ids únicos, en snake_case, y rótulos únicos y no vacíos", (role) => {
    const chips = specialtiesFor(role);
    expect(chips.length).toBeGreaterThanOrEqual(8);
    const ids = chips.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9_]*$/);
    const labels = chips.map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const c of chips) expect(c.label.trim()).not.toBe("");
  });

  it.each(roles)(
    "%s: los términos van normalizados (sin acentos ni mayúsculas ni signos)",
    (role) => {
      for (const chip of specialtiesFor(role)) {
        for (const term of chip.terms) expect(term).toMatch(/^[a-z0-9]+(?: [a-z0-9]+)*$/);
      }
    },
  );
});

describe("ROLE_SPECIALTIES · cobertura de TITLE_TERMS", () => {
  it.each(roles)("%s: la unión de los términos de los chips es TITLE_TERMS", (role) => {
    const union = new Set(specialtiesFor(role).flatMap((c) => c.terms));
    expect([...union].sort()).toEqual([...new Set(TITLE_TERMS[role])].sort());
  });

  it.each(roles)("%s: sin términos repetidos dentro de un chip", (role) => {
    for (const chip of specialtiesFor(role)) {
      expect(new Set(chip.terms).size).toBe(chip.terms.length);
    }
  });
});

describe("specialtiesFor", () => {
  it("una carrera sin chips devuelve una lista vacía", () => {
    expect(specialtiesFor("frontend")).toEqual([]);
  });
});

describe("termsForSpecialties", () => {
  it("junta los términos de los chips pedidos, sin repetir", () => {
    const terms = termsForSpecialties("finanzas_contabilidad", ["sueldos", "impuestos"]);
    expect(terms).toContain("payroll");
    expect(terms).toContain("tax analyst");
    expect(new Set(terms).size).toBe(terms.length);
  });

  it("ignora ids que no existen en la carrera", () => {
    expect(termsForSpecialties("finanzas_contabilidad", ["no_existe"])).toEqual([]);
    expect(termsForSpecialties("frontend", ["sueldos"])).toEqual([]);
  });
});

describe("specialtyIdsForTitle", () => {
  it("dice qué chips nombra el título, con límite de palabra", () => {
    expect(specialtyIdsForTitle("Payroll Specialist", "finanzas_contabilidad")).toEqual([
      "sueldos",
    ]);
    expect(specialtyIdsForTitle("Tax Analyst", "finanzas_contabilidad")).toEqual(["impuestos"]);
    expect(specialtyIdsForTitle("Senior Accountant", "finanzas_contabilidad")).toEqual([
      "contabilidad_y_balances",
    ]);
  });

  it("un título sin términos de la carrera no da ningún chip", () => {
    expect(specialtyIdsForTitle("Backend Developer", "finanzas_contabilidad")).toEqual([]);
    expect(specialtyIdsForTitle("Accountant", "frontend")).toEqual([]);
  });

  it("un título puede nombrar más de un chip", () => {
    const ids = specialtyIdsForTitle("Payroll Accountant", "finanzas_contabilidad");
    expect(ids).toEqual(["sueldos", "contabilidad_y_balances"]);
  });

  it("los chips salen en el orden del catálogo, no en el del título", () => {
    expect(specialtyIdsForTitle("Internal Audit and Tax Analyst", "finanzas_contabilidad")).toEqual(
      ["impuestos", "auditoria"],
    );
  });
});

describe("ROLE_SPECIALTIES · ejemplos y áreas poco publicadas (R2-2)", () => {
  it.each(roles)("%s: cada chip tiene 2 o 3 ejemplos en lenguaje simple", (role) => {
    for (const chip of specialtiesFor(role)) {
      expect(chip.examples).toBeDefined();
      expect(chip.examples!.length).toBeGreaterThanOrEqual(2);
      expect(chip.examples!.length).toBeLessThanOrEqual(3);
      for (const ex of chip.examples!) {
        expect(ex.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("marca 'te avisamos si aparece' (rare) exactamente en las 3 áreas poco publicadas", () => {
    const rareChips: { role: RoleKey; id: string }[] = [];
    for (const role of roles) {
      for (const chip of specialtiesFor(role)) {
        if (chip.rare) rareChips.push({ role, id: chip.id });
      }
    }
    expect(rareChips).toEqual([
      { role: "finanzas_contabilidad", id: "concursos_y_pericias_judiciales" },
      { role: "abogacia", id: "familia_y_sucesiones" },
      { role: "relaciones_internacionales", id: "diplomacia" },
    ]);
  });
});
