import { describe, expect, it } from "vitest";
import {
  careerAccess,
  CAREER_OPENING_ACTIONS,
  isOpenableCareer,
  parseOpenCareers,
  summarizeCareerOpening,
} from "./career-opening";
import { BETA_LAUNCH_ROLE_KEYS, ROLE_KEYS } from "./skills/self-assessment";

describe("isOpenableCareer", () => {
  it("las carreras del catálogo se pueden abrir", () => {
    for (const key of BETA_LAUNCH_ROLE_KEYS) expect(isOpenableCareer(key), key).toBe(true);
    expect(isOpenableCareer("qa")).toBe(true);
  });
  it("«Otra», lo vacío y lo inventado nunca", () => {
    for (const v of ["otra", "Otra", "", " ", "no_existe", null, undefined, 3, "abogacia "]) {
      expect(isOpenableCareer(v), String(v)).toBe(false);
    }
  });
});

describe("parseOpenCareers", () => {
  it("deja solo claves conocidas, sin repetir, en el orden del catálogo", () => {
    expect(parseOpenCareers(["fullstack", "abogacia", "abogacia", "no_existe", "otra"])).toEqual(
      ROLE_KEYS.filter((k) => k === "abogacia" || k === "fullstack"),
    );
  });
  it("lo que no es una lista queda vacío (falla cerrado: nada abierto)", () => {
    expect(parseOpenCareers(null)).toEqual([]);
    expect(parseOpenCareers(undefined)).toEqual([]);
    expect(parseOpenCareers("abogacia")).toEqual([]);
    expect(parseOpenCareers({})).toEqual([]);
  });
  it("«Otra» nunca queda abierta aunque venga en la lista", () => {
    expect(parseOpenCareers(["otra"])).toEqual([]);
  });
});

describe("careerAccess · alta nueva", () => {
  it("carrera abierta: entra", () => {
    expect(
      careerAccess({ career: "abogacia", openCareers: ["abogacia"], existingAccount: false }),
    ).toEqual({ access: "abierta" });
  });
  it("carrera cerrada: va a la lista de espera de su carrera", () => {
    expect(
      careerAccess({ career: "comunicacion", openCareers: ["abogacia"], existingAccount: false }),
    ).toEqual({ access: "lista_de_espera", reason: "cerrada", career: "comunicacion" });
  });
  it("con la lista vacía, toda alta nueva espera", () => {
    for (const career of BETA_LAUNCH_ROLE_KEYS) {
      expect(careerAccess({ career, openCareers: [], existingAccount: false })).toEqual({
        access: "lista_de_espera",
        reason: "cerrada",
        career,
      });
    }
  });
  it("«Otra» siempre espera, aunque la lista la traiga", () => {
    expect(careerAccess({ career: "otra", openCareers: ["otra"], existingAccount: false })).toEqual(
      { access: "lista_de_espera", reason: "otra", career: null },
    );
    expect(careerAccess({ career: "otra", openCareers: [], existingAccount: false })).toEqual({
      access: "lista_de_espera",
      reason: "otra",
      career: null,
    });
  });
  it("sin carrera o con una clave inventada: espera, sin carrera", () => {
    for (const career of [null, undefined, "", "no_existe"]) {
      expect(careerAccess({ career, openCareers: ["abogacia"], existingAccount: false })).toEqual({
        access: "lista_de_espera",
        reason: "sin_carrera",
        career: null,
      });
    }
  });
  it("una lista rota no abre nada", () => {
    expect(
      careerAccess({ career: "abogacia", openCareers: null as never, existingAccount: false }),
    ).toEqual({ access: "lista_de_espera", reason: "cerrada", career: "abogacia" });
  });
});

describe("careerAccess · cuenta anterior", () => {
  it("quien ya está adentro no pierde nada, esté su carrera abierta, cerrada, vacía o sea «Otra»", () => {
    for (const career of ["abogacia", "comunicacion", "otra", null, "no_existe"]) {
      for (const openCareers of [[], ["abogacia"], ["fullstack"]]) {
        expect(careerAccess({ career, openCareers, existingAccount: true }), `${career}`).toEqual({
          access: "dentro",
        });
      }
    }
  });
});

describe("summarizeCareerOpening", () => {
  it("una fila por carrera de la beta, con su estado, y las abiertas fuera de la beta al final", () => {
    const rows = summarizeCareerOpening(["abogacia", "qa"]);
    expect(rows.map((r) => r.career)).toEqual([...BETA_LAUNCH_ROLE_KEYS, "qa"]);
    expect(rows.find((r) => r.career === "abogacia")?.open).toBe(true);
    expect(rows.find((r) => r.career === "qa")?.open).toBe(true);
    expect(rows.find((r) => r.career === "fullstack")?.open).toBe(false);
  });
  it("sin nada abierto, todas cerradas", () => {
    expect(summarizeCareerOpening([]).every((r) => !r.open)).toBe(true);
  });
});

describe("acciones del historial", () => {
  it("son abrir y cerrar", () => {
    expect(CAREER_OPENING_ACTIONS).toEqual(["abrir", "cerrar"]);
  });
});
