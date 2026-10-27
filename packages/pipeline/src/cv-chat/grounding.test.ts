import { describe, expect, it } from "vitest";
import { CV_FIXED_ACK, extractionGrounded, safeCvAck } from "./grounding";

describe("extractionGrounded", () => {
  it("acepta lo que la persona dijo, sin mirar mayúsculas ni acentos", () => {
    const msg = "trabajé en empresa a como analista, armé reportes en sql para 12 sucursales";
    expect(extractionGrounded({ organization: "Empresa A", noExperience: false }, msg)).toBe(true);
    expect(extractionGrounded({ duties: ["Armé reportes en SQL para 12 sucursales"] }, msg)).toBe(
      true,
    );
  });

  it("rechaza números, nombres y tecnologías que el mensaje no trae", () => {
    const msg = "Armé reportes para Empresa A";
    expect(extractionGrounded({ duties: ["Armé 40 reportes"] }, msg)).toBe(false);
    expect(extractionGrounded({ organization: "Empresa B", noExperience: false }, msg)).toBe(false);
    expect(extractionGrounded({ skills: ["PostgreSQL"] }, msg)).toBe(false);
  });

  it("no mira los meses ni las banderas", () => {
    expect(
      extractionGrounded({ startMonth: "2021-01", endMonth: null, isCurrent: true }, "desde 2021"),
    ).toBe(true);
  });

  it("los links tienen que estar tal cual en el mensaje", () => {
    const url = "https://ejemplo.example.test/persona";
    expect(
      extractionGrounded({ linkedin: url, github: null, portfolio: null }, `mi link ${url}`),
    ).toBe(true);
    expect(extractionGrounded({ linkedin: url, github: null, portfolio: null }, "no tengo")).toBe(
      false,
    );
  });

  it("una extracción vacía pasa", () => {
    expect(extractionGrounded({ entries: [] }, "no tengo")).toBe(true);
  });
});

describe("safeCvAck", () => {
  it("deja un acuse limpio", () => {
    expect(safeCvAck("  Dale, lo anoto.  ")).toBe("Dale, lo anoto.");
  });
  it("con dígitos, vacío o con link usa el fijo", () => {
    expect(safeCvAck("Anotado, 10 años")).toBe(CV_FIXED_ACK);
    expect(safeCvAck(null)).toBe(CV_FIXED_ACK);
    expect(safeCvAck("https://x.example")).toBe(CV_FIXED_ACK);
  });
});
