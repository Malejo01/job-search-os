import { describe, expect, it } from "vitest";
import { firstName, greeting } from "./greeting";

const AR = "America/Argentina/Buenos_Aires";

describe("greeting (encabezado de Hoy, C7-7)", () => {
  it("buen día de 5 a 12, buenas tardes de 12 a 20 y buenas noches el resto, en la zona del perfil", () => {
    // 11:00 UTC = 8:00 en Argentina
    expect(greeting(new Date("2026-11-03T11:00:00Z"), AR)).toBe("Buen día");
    // 16:00 UTC = 13:00
    expect(greeting(new Date("2026-11-03T16:00:00Z"), AR)).toBe("Buenas tardes");
    // 01:00 UTC = 22:00 del día anterior
    expect(greeting(new Date("2026-11-03T01:00:00Z"), AR)).toBe("Buenas noches");
    // 07:00 UTC = 4:00
    expect(greeting(new Date("2026-11-03T07:00:00Z"), AR)).toBe("Buenas noches");
  });

  it("una zona inválida no rompe: usa la de Argentina", () => {
    expect(greeting(new Date("2026-11-03T11:00:00Z"), "No/Existe")).toBe("Buen día");
  });
});

describe("firstName", () => {
  it("la primera palabra, sin espacios de más", () => {
    expect(firstName("  Lucía   Martínez ")).toBe("Lucía");
  });
  it("sin nombre, null", () => {
    expect(firstName("")).toBeNull();
    expect(firstName(null)).toBeNull();
  });
  it("corta nombres larguísimos", () => {
    expect(firstName("x".repeat(80))?.length).toBe(40);
  });
});
