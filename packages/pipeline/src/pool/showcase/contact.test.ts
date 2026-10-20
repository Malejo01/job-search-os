import { describe, expect, it } from "vitest";
import { buildMailto, parseContactEmail } from "./contact";

describe("parseContactEmail", () => {
  it("acepta un email válido y lo recorta", () => {
    expect(parseContactEmail("  contacto@example.com ")).toBe("contacto@example.com");
  });

  it("devuelve null si falta o está vacío", () => {
    expect(parseContactEmail(undefined)).toBeNull();
    expect(parseContactEmail(null)).toBeNull();
    expect(parseContactEmail("")).toBeNull();
    expect(parseContactEmail("   ")).toBeNull();
  });

  it("devuelve null si no tiene formato de email", () => {
    expect(parseContactEmail("sin-arroba")).toBeNull();
    expect(parseContactEmail("a b@example.com")).toBeNull();
    expect(parseContactEmail("contacto@")).toBeNull();
  });
});

describe("buildMailto", () => {
  it("codifica el asunto con espacios", () => {
    expect(buildMailto("contacto@example.com", "Retirar un aviso")).toBe(
      "mailto:contacto@example.com?subject=Retirar%20un%20aviso",
    );
  });

  it("codifica acentos y signos", () => {
    const href = buildMailto("contacto@example.com", "Borrar mis datos: ¿lista?");
    expect(href).toBe(
      "mailto:contacto@example.com?subject=Borrar%20mis%20datos%3A%20%C2%BFlista%3F",
    );
    expect(decodeURIComponent(href.split("subject=")[1] ?? "")).toBe("Borrar mis datos: ¿lista?");
  });
});
