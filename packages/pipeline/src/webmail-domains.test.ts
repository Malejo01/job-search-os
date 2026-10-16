import { describe, expect, it } from "vitest";
import { isExpectedSender } from "./filter-leak";
import { isWebmailDomain, WEBMAIL_DOMAINS } from "./webmail-domains";

/**
 * Ronda 58 (RM-3). Un dominio de webmail nunca puede ser "fuente de empleo": si lo fuera, se
 * guardarían completos los mails de cualquier persona con esa cuenta.
 */
describe("isWebmailDomain", () => {
  it.each(WEBMAIL_DOMAINS.map((d) => [d]))("%s es webmail", (d) => {
    expect(isWebmailDomain(d)).toBe(true);
  });

  it.each([
    ["yahoo.com.ar"],
    ["hotmail.com.ar"],
    ["outlook.es"],
    ["live.com.mx"],
    ["gmail.com.br"],
    ["hotmail.es"],
    ["yahoo.es"],
    ["yahoo.co.uk"],
    ["outlook.com.br"],
    ["live.it"],
    ["icloud.com.mx"],
  ])("variante de país %s es webmail", (d) => {
    expect(isWebmailDomain(d)).toBe(true);
  });

  it.each([["GMAIL.com"], ["  Gmail.Com "], ["Hotmail.COM.ar"], ["gmail.com."], ["gmail.com.."]])(
    "mayúsculas y espacios: %s",
    (d) => {
      expect(isWebmailDomain(d)).toBe(true);
    },
  );

  it.each([
    ["fibertel.com.ar"],
    ["mail.speedy.com.ar"],
    ["terra.com.br"],
    ["prodigy.net.mx"],
    ["mail.ru"],
    ["protonmail.ch"],
    ["tutamail.com"],
    ["duck.com"],
    ["web.de"],
  ])("ISP y proveedor extra %s es webmail", (d) => {
    expect(isWebmailDomain(d)).toBe(true);
  });

  it("un subdominio de un proveedor también", () => {
    expect(isWebmailDomain("mail.yahoo.com.ar")).toBe(true);
    expect(isWebmailDomain("smtp.gmail.com")).toBe(true);
  });

  it.each([
    ["linkedin.com"],
    ["empresa-a.com"],
    ["mails.banco.example"],
    ["gmail-jobs.example"],
    ["getonbrd.com"],
    ["notgmail.com"],
    ["gmail.com.empresa-a.example"],
    ["yahoo.example"],
    [""],
  ])("%s no es webmail", (d) => {
    expect(isWebmailDomain(d)).toBe(false);
  });

  it("ninguna fuente de empleo fija es webmail", async () => {
    const { EXPECTED_SOURCE_DOMAINS } = await import("./filter-leak");
    for (const d of EXPECTED_SOURCE_DOMAINS) expect(isWebmailDomain(d)).toBe(false);
  });
});

describe("isExpectedSender con webmail", () => {
  it("ignora un 'empleo' del usuario sobre un dominio de webmail (filas viejas incluidas)", () => {
    const from = (d: string) => `Persona A <alguien-${d.length}@${d}>`;
    expect(isExpectedSender(from("gmail.com"), ["gmail.com"])).toBe(false);
    expect(isExpectedSender(from("yahoo.com.ar"), ["yahoo.com.ar"])).toBe(false);
    expect(isExpectedSender(from("Outlook.es"), ["outlook.es"])).toBe(false);
  });

  it("sigue aceptando un dominio propio marcado y las fuentes fijas", () => {
    expect(isExpectedSender("x@empresa-a.example", ["empresa-a.example"])).toBe(true);
    expect(isExpectedSender("x@linkedin.com", [])).toBe(true);
  });
});
