import { describe, expect, it } from "vitest";
import { isExpectedSender, senderHost } from "./filter-leak";
import { authResultsVerdict, parseFromAddress, parseInboundDmarcMode } from "./from-address";
import { classifyInbound, GMAIL_FORWARDING_SENDER } from "./inbound-classify";

describe("parseFromAddress", () => {
  it.each([
    ["jobs@linkedin.com", "jobs@linkedin.com"],
    ["  JOBS@LinkedIn.com ", "jobs@linkedin.com"],
    ["LinkedIn <jobs@linkedin.com>", "jobs@linkedin.com"],
    ['"LinkedIn Alerts" <jobs@linkedin.com>', "jobs@linkedin.com"],
    ['"Pérez, Ana" <ana@example.com>', "ana@example.com"],
    ["Pérez, Ana <ana@example.com>", "ana@example.com"],
    ['"Ana \\"la jefa\\"" <ana@example.com>', "ana@example.com"],
    ["Ana (área de talento) <ana@example.com>", "ana@example.com"],
    ["ana@example.com (Ana)", "ana@example.com"],
    ["<ana@example.com>", "ana@example.com"],
  ])("lee %s", (from, address) => {
    expect(parseFromAddress(from)).toBe(address);
  });

  it.each([
    ['"LinkedIn <jobs@linkedin.com>" <bot@otro.example>', "bot@otro.example"],
    ["(<jobs@linkedin.com>) <bot@otro.example>", "bot@otro.example"],
    ['"a\\" <jobs@linkedin.com> \\"b" <bot@otro.example>', "bot@otro.example"],
  ])("toma la dirección real y no la del nombre visible: %s", (from, address) => {
    expect(parseFromAddress(from)).toBe(address);
  });

  it.each([
    "",
    "sin arroba",
    "LinkedIn <jobs@linkedin.com> <bot@otro.example>",
    "<jobs@linkedin.com> <bot@otro.example>",
    "A <a@linkedin.com>, B <b@otro.example>",
    "a@linkedin.com, b@otro.example",
    '"sin cerrar <jobs@linkedin.com>',
    "(sin cerrar <jobs@linkedin.com>",
    "Ana <ana@example.com",
    "Ana ana@example.com>",
    "<ana@example.com> texto después",
    "a@b@example.com",
    "<>",
    `${"x".repeat(5000)}@example.com`,
  ])("falla cerrado con %s", (from) => {
    expect(parseFromAddress(from)).toBeNull();
  });
});

describe("remitentes falsificados", () => {
  const SPOOFS = [
    '"LinkedIn <jobs-noreply@linkedin.com>" <bot@otro.example>',
    '"Indeed <alert@indeed.com>" <bot@otro.example>',
    "(<jobs-noreply@linkedin.com>) bot@otro.example",
    "LinkedIn <jobs-noreply@linkedin.com> <bot@otro.example>",
    "jobs-noreply@linkedin.com <bot@otro.example>",
    '"jobs-noreply@linkedin.com" <bot@otro.example>',
    "<jobs-noreply@linkedin.com",
  ];

  it.each(SPOOFS)("%s no es un remitente esperado", (from) => {
    expect(isExpectedSender(from, [])).toBe(false);
  });

  it("una dirección ilegible no tiene host", () => {
    expect(senderHost("LinkedIn <a@linkedin.com> <b@otro.example>")).toBe("");
  });

  it("una confirmación de reenvío con el remitente en el nombre visible no se reconoce", () => {
    const { category } = classifyInbound({
      from: `"Gmail <${GMAIL_FORWARDING_SENDER}>" <bot@otro.example>`,
      subject: "(#1) Gmail Forwarding Confirmation - Receive Mail from ana@example.com",
      text: "ana@example.com has requested to automatically forward mail to you.",
    });

    expect(category).not.toBe("confirmacion_reenvio_gmail");
  });

  it("una postulación con el remitente en el nombre visible no se reconoce", () => {
    const { category } = classifyInbound({
      from: '"LinkedIn <jobs-noreply@linkedin.com>" <bot@otro.example>',
      subject: "Your application was sent to Empresa A",
      text: "Your application was sent to Empresa A",
    });

    expect(category).not.toBe("postulacion_enviada");
  });

  it("los remitentes reales siguen siendo esperados", () => {
    expect(isExpectedSender("LinkedIn <jobs-noreply@linkedin.com>", [])).toBe(true);
    expect(isExpectedSender('"Get on Board" <hola@getonbrd.com>', [])).toBe(true);
    expect(isExpectedSender("alert@indeed.com", [])).toBe(true);
  });
});

describe("authResultsVerdict", () => {
  it.each([
    [{ "Authentication-Results": "mx.example; dmarc=fail header.from=portal.example" }],
    [{ "authentication-results": "mx.example; spf=pass; DMARC=FAIL (p=reject)" }],
    [{ "Authentication-Results": ["mx.example; dmarc=pass", "mx.otro; dmarc=fail"] }],
    [{ "Received-SPF": "fail (dominio no autorizado)" }],
  ])("fail con %j", (headers) => {
    expect(authResultsVerdict(headers)).toBe("fail");
  });

  it.each([
    [{ "Authentication-Results": "mx.example; dmarc=pass" }],
    [{ "Authentication-Results": "mx.example; dkim=pass header.d=portal.example" }],
    [{ "Received-SPF": "pass (dominio autorizado)" }],
  ])("aligned con %j", (headers) => {
    expect(authResultsVerdict(headers)).toBe("aligned");
  });

  it.each([
    [null],
    [undefined],
    [{}],
    [{ Subject: "dmarc=fail" }],
    [{ "Authentication-Results": "mx.example; dmarc=none" }],
    [{ "DKIM-Signature": "v=1; d=portal.example" }],
  ])("none con %j", (headers) => {
    expect(authResultsVerdict(headers)).toBe("none");
  });
});

describe("parseInboundDmarcMode", () => {
  it.each([
    ["off", "off"],
    ["log", "log"],
    ["enforce", "enforce"],
    [" ENFORCE ", "enforce"],
    [undefined, "log"],
    ["", "log"],
    ["otro", "log"],
  ])("%j da %s", (raw, mode) => {
    expect(parseInboundDmarcMode(raw)).toBe(mode);
  });
});
