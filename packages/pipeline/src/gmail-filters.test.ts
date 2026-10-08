import { describe, expect, it } from "vitest";
import { DEFAULT_ALERT_SENDERS, gmailFiltersXml } from "./gmail-filters";

const ADDRESS = "u_abcdefghij234567abcd@ingesta.example.test";
const NOW = new Date("2026-10-08T12:00:00Z");

describe("gmailFiltersXml", () => {
  it("incluye la dirección y todos los remitentes", () => {
    const xml = gmailFiltersXml({ forwardTo: ADDRESS, senders: DEFAULT_ALERT_SENDERS, now: NOW });
    expect(xml).toContain(`<apps:property name='forwardTo' value='${ADDRESS}'/>`);
    for (const sender of DEFAULT_ALERT_SENDERS) expect(xml).toContain(sender);
    expect(xml).toContain(`name='from' value='${DEFAULT_ALERT_SENDERS.join(" OR ")}'`);
  });

  it("archiva y no marca como leído", () => {
    const xml = gmailFiltersXml({ forwardTo: ADDRESS, senders: ["a@x.test"], now: NOW });
    expect(xml).toContain("name='shouldArchive' value='true'");
    expect(xml).not.toContain("shouldMarkAsRead");
    expect(xml).toContain('xmlns:apps="http://schemas.google.com/apps/2006"');
  });

  it("usa la fecha recibida, no la actual", () => {
    const xml = gmailFiltersXml({ forwardTo: ADDRESS, senders: ["a@x.test"], now: NOW });
    expect(xml).toContain("<updated>2026-10-08T12:00:00.000Z</updated>");
  });

  it("escapa los caracteres especiales de XML", () => {
    const xml = gmailFiltersXml({ forwardTo: ADDRESS, senders: [`a&b<c>"d'@x.test`], now: NOW });
    expect(xml).toContain("a&amp;b&lt;c&gt;&quot;d&apos;@x.test");
    expect(xml).not.toContain("a&b<c>");
  });

  it("rechaza una dirección inválida", () => {
    for (const bad of [
      "",
      "u_corta@ingesta.example.test",
      "u_1a2b3c4d@ingesta.example.test",
      "otro@ingesta.example.test",
      "u_abcdefghij234567abcd@",
      "u_abcdefghij234567abcd@a b.test",
      "u_abcdefghij234567abcd@x.test'/><evil",
    ]) {
      expect(() => gmailFiltersXml({ forwardTo: bad, senders: ["a@x.test"], now: NOW })).toThrow(
        /dirección/,
      );
    }
  });

  it("rechaza una lista de remitentes vacía", () => {
    expect(() => gmailFiltersXml({ forwardTo: ADDRESS, senders: [], now: NOW })).toThrow(
      /remitentes/,
    );
  });

  it("el XML está bien formado (etiquetas balanceadas, una sola entrada)", () => {
    const xml = gmailFiltersXml({ forwardTo: ADDRESS, senders: DEFAULT_ALERT_SENDERS, now: NOW });
    expect(xml.startsWith("<?xml version='1.0' encoding='UTF-8'?>")).toBe(true);
    expect(xml.match(/<feed\b/g)).toHaveLength(1);
    expect(xml.match(/<\/feed>/g)).toHaveLength(1);
    expect(xml.match(/<entry>/g)).toHaveLength(1);
    expect(xml.match(/<\/entry>/g)).toHaveLength(1);
    // Todo `&` es parte de una entidad válida
    expect(xml.replace(/&(amp|lt|gt|quot|apos);/g, "")).not.toContain("&");
  });
});

describe("DEFAULT_ALERT_SENDERS", () => {
  it("cubre LinkedIn empleo, Get on Board e Indeed", () => {
    expect(DEFAULT_ALERT_SENDERS).toEqual(
      expect.arrayContaining([
        "jobalerts-noreply@linkedin.com",
        "jobs-noreply@linkedin.com",
        "getonbrd.com",
        "getonboard.com",
        "indeed.com",
      ]),
    );
  });
});
