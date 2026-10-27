import { describe, expect, it } from "vitest";
import { isPoolAlertSender, readPoolInboundConfig } from "./pool-mailbox";

describe("readPoolInboundConfig", () => {
  it("solo el valor exacto «1» prende el interruptor", () => {
    for (const v of [undefined, "", "0", "true", "si", " 1", "1 ", "yes"]) {
      expect(readPoolInboundConfig({ POOL_SOURCE_COMPUTRABAJO_ALERTS: v }).enabled, String(v)).toBe(
        false,
      );
    }
    expect(readPoolInboundConfig({ POOL_SOURCE_COMPUTRABAJO_ALERTS: "1" }).enabled).toBe(true);
  });

  it("normaliza el dominio de ingesta", () => {
    expect(readPoolInboundConfig({ INGEST_DOMAIN: " Ingest.Ejemplo.Test " }).ingestDomain).toBe(
      "ingest.ejemplo.test",
    );
  });
});

describe("isPoolAlertSender", () => {
  const domains = ["avisos-ejemplo.example"];
  it("acepta el dominio, subdominios, con nombre visible", () => {
    expect(isPoolAlertSender("a@avisos-ejemplo.example", domains)).toBe(true);
    expect(isPoolAlertSender("Avisos <a@mail.avisos-ejemplo.example>", domains)).toBe(true);
    // Las variantes por país se listan como dominios propios, no se adivinan por sufijo
    expect(isPoolAlertSender("avisos@avisos-ejemplo.example", ["otro-dominio.example"])).toBe(
      false,
    );
  });

  it("rechaza parecidos y direcciones mal formadas", () => {
    expect(isPoolAlertSender("a@xavisos-ejemplo.example", domains)).toBe(false);
    expect(isPoolAlertSender("avisos-ejemplo.example", domains)).toBe(false);
    expect(isPoolAlertSender("a@b@avisos-ejemplo.example", domains)).toBe(false);
  });
});
