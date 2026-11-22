import { describe, expect, it } from "vitest";
import { inboundConfigWarnings } from "./env-modes";

describe("inboundConfigWarnings", () => {
  it("sin variables o con valores válidos no avisa nada", () => {
    expect(inboundConfigWarnings({})).toEqual([]);
    expect(
      inboundConfigWarnings({
        INBOUND_SIZE_MODE: " ENFORCE ",
        INBOUND_DMARC_MODE: "log",
        INBOUND_RAW_RETENTION_DAYS: "30",
        INBOUND_MAX_BYTES_PER_USER: "209715200",
      }),
    ).toEqual([]);
  });

  it("un modo mal escrito avisa con el nombre de la variable y sin copiar el valor", () => {
    const warnings = inboundConfigWarnings({
      INBOUND_SIZE_MODE: "enforse",
      INBOUND_DMARC_MODE: "obligatorio",
    });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("INBOUND_SIZE_MODE");
    expect(warnings[1]).toContain("INBOUND_DMARC_MODE");
    expect(warnings.join(" ")).not.toContain("enforse");
    expect(warnings.join(" ")).not.toContain("obligatorio");
  });

  it("INBOUND_DMARC_MODE=enforce sin INBOUND_AUTHSERV_ID avisa", () => {
    const warnings = inboundConfigWarnings({ INBOUND_DMARC_MODE: "enforce" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("INBOUND_AUTHSERV_ID");
  });

  it("enforce con INBOUND_AUTHSERV_ID configurado no avisa; con espacios en blanco sí", () => {
    expect(
      inboundConfigWarnings({ INBOUND_DMARC_MODE: "enforce", INBOUND_AUTHSERV_ID: "mx.example" }),
    ).toEqual([]);
    expect(
      inboundConfigWarnings({ INBOUND_DMARC_MODE: "enforce", INBOUND_AUTHSERV_ID: "   " }),
    ).toHaveLength(1);
  });

  it("un plazo o un tope numérico inválido avisa", () => {
    const warnings = inboundConfigWarnings({
      INBOUND_RAW_RETENTION_DAYS: "30d",
      INBOUND_MAX_BYTES_PER_USER: "mucho",
    });
    expect(warnings).toHaveLength(2);
    expect(warnings.join(" ")).not.toContain("30d");
  });
});
