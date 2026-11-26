import { describe, expect, it } from "vitest";
import { sameUrl } from "../lib/same-url";

describe("sameUrl", () => {
  it("normaliza www, barra final, fragmento, mayúsculas del dominio y http/https", () => {
    expect(
      sameUrl("https://www.Empresa-A.example/ofertas/1/", "http://empresa-a.example/ofertas/1#x"),
    ).toBe(true);
  });

  it("la ruta y la consulta distinguen", () => {
    expect(
      sameUrl("https://empresa-a.example/ofertas/1", "https://empresa-a.example/ofertas/2"),
    ).toBe(false);
    expect(sameUrl("https://empresa-a.example/o?id=1", "https://empresa-a.example/o?id=2")).toBe(
      false,
    );
    expect(sameUrl("https://empresa-a.example/o", "https://empresa-b.example/o")).toBe(false);
  });

  it("ante la duda no son iguales", () => {
    expect(sameUrl(null, "https://empresa-a.example/o")).toBe(false);
    expect(sameUrl("no es url", "no es url")).toBe(false);
    expect(sameUrl("javascript:alert(1)", "javascript:alert(1)")).toBe(false);
  });
});
