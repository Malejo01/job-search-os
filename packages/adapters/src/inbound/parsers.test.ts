import { describe, expect, it } from "vitest";
import { baseDomain, EXPECTED_SOURCE_DOMAINS } from "@job-search-os/pipeline";
import { chooseParserName, linkedinSenderKind } from "./parsers";

/**
 * JS-050 · Ruido social de LinkedIn. Viene del mismo dominio que las alertas, así que la regla
 * es por la dirección exacta del remitente. Revisado contra los 22 emails de LinkedIn de
 * producción (2026-09-22): separa los 22 sin excepción.
 */
describe("linkedinSenderKind", () => {
  it.each([
    ["Alertas de empleo de LinkedIn <jobalerts-noreply@linkedin.com>", "empleo"],
    ["LinkedIn <jobs-noreply@linkedin.com>", "empleo"],
    ["LinkedIn <messages-noreply@linkedin.com>", "social"],
    ["LinkedIn <invitations@linkedin.com>", "social"],
    ["LinkedIn <notifications-noreply@linkedin.com>", "social"],
  ] as const)("%s → %s", (from, kind) => {
    expect(linkedinSenderKind(from)).toBe(kind);
  });

  it("no distingue mayúsculas y acepta la dirección sola", () => {
    expect(linkedinSenderKind("MESSAGES-NOREPLY@LinkedIn.com")).toBe("social");
    expect(linkedinSenderKind("jobalerts-noreply@linkedin.com")).toBe("empleo");
  });

  it("un remitente de LinkedIn que no conocemos sigue el camino de siempre", () => {
    expect(linkedinSenderKind("LinkedIn <hit-reply@linkedin.com>")).toBe("desconocido");
    expect(linkedinSenderKind("LinkedIn <jobs-listings@e.linkedin.com>")).toBe("desconocido");
  });

  it("otro dominio no es LinkedIn, aunque la parte local coincida", () => {
    expect(linkedinSenderKind("Falso <messages-noreply@linkedin.com.example.org>")).toBeNull();
    expect(linkedinSenderKind("Banco <messages-noreply@banco.example>")).toBeNull();
    expect(chooseParserName("Banco <messages-noreply@banco.example>")).toBe("generic");
  });
});

describe("fuentes esperadas de JS-048", () => {
  it("todo dominio que tiene parser propio es una fuente esperada (no avisa como fuga)", () => {
    for (const from of [
      "x@linkedin.com",
      "x@e.linkedin.com",
      "x@getonbrd.com",
      "x@getonboard.com",
    ]) {
      expect(chooseParserName(from)).not.toBe("generic");
      expect(EXPECTED_SOURCE_DOMAINS).toContain(baseDomain(from.split("@")[1]!));
    }
  });
});
