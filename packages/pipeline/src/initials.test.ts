import { describe, expect, it } from "vitest";
import { initials } from "./initials";

describe("initials (avatar del header, C7-5)", () => {
  it("toma la primera letra de las dos primeras palabras, en mayúscula", () => {
    expect(initials("Lucía Martínez")).toBe("LM");
    expect(initials("ana maría pérez")).toBe("AM");
  });

  it("con una sola palabra, una letra", () => {
    expect(initials("Mauro")).toBe("M");
  });

  it("respeta tildes y la ñ", () => {
    expect(initials("Ñandú Ábalos")).toBe("ÑÁ");
  });

  it("ignora espacios de más y lo que no es letra al principio", () => {
    expect(initials("  (Lu)   García  ")).toBe("LG");
  });

  it("sin nombre usable devuelve null", () => {
    expect(initials("")).toBeNull();
    expect(initials("   ")).toBeNull();
    expect(initials("123 !!")).toBeNull();
  });
});
