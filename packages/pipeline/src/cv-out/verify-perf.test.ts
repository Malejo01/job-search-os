import { describe, expect, it } from "vitest";
import { cleanCvText, hasLinkOrEmail } from "./verify";

/**
 * El armado del CV no se cuelga con texto largo: `cleanCvText` y `hasLinkOrEmail` corren sus expresiones sobre
 * el texto entero, así que cada una tiene que ser lineal. Los casos son formas que alargan el trabajo de una
 * expresión mal acotada: una palabra interminable, un usuario sin dominio, puntos y guiones encadenados.
 */
const SHAPES: Record<string, (n: number) => string> = {
  "palabra sin espacios": (n) => "a".repeat(n),
  "usuario largo con arroba y sin punto": (n) => `${"a".repeat(n / 2)}@${"b".repeat(n / 2)}`,
  "arrobas repetidas": (n) => "a@".repeat(n / 2),
  "puntos encadenados": (n) => "ab.".repeat(n / 3),
  "puntos sin extensión conocida": (n) => `${"ab.".repeat(n / 3)}zz`,
  "guiones encadenados": (n) => "a-".repeat(n / 2),
  "extensión repetida": (n) => "a.com".repeat(n / 5),
  "separadores raros": (n) => "a._".repeat(n / 3),
  "barras y puntos": (n) => "a./".repeat(n / 3),
};

describe("cleanCvText y hasLinkOrEmail con texto largo", () => {
  for (const size of [20_000, 400_000]) {
    for (const [name, make] of Object.entries(SHAPES)) {
      it(`${size} caracteres: ${name}`, () => {
        const text = make(size);
        const t0 = performance.now();
        cleanCvText(text);
        hasLinkOrEmail(text);
        expect(performance.now() - t0).toBeLessThan(100);
      });
    }
  }

  it("el resultado para textos normales no cambia", () => {
    expect(
      cleanCvText("Escribime a ana@example.com o mirá ejemplo.com/x y www.sitio.example"),
    ).toBe("Escribime a o mirá y");
    expect(cleanCvText("hola mundo")).toBe("Hola mundo");
    expect(hasLinkOrEmail("ana@example.com")).toBe(true);
    expect(hasLinkOrEmail("ana@example")).toBe(false);
    expect(hasLinkOrEmail("usé Node.js y ASP.NET")).toBe(false);
  });
});
