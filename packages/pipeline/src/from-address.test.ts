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
  const ID = "mx.example";
  const FROM = "Portal <aviso@portal.example>";
  const verdict = (headers: Record<string, unknown> | null | undefined) =>
    authResultsVerdict(headers, ID, FROM);

  it.each([
    [{ "Authentication-Results": "mx.example; dmarc=fail header.from=portal.example" }],
    [{ "authentication-results": "mx.example; spf=pass; DMARC=FAIL (p=reject)" }],
    // pasa DMARC pero para otro dominio: no alinea con el From
    [{ "Authentication-Results": "mx.example; dmarc=pass header.from=otro.example" }],
  ])("fail con %j", (headers) => {
    expect(verdict(headers)).toBe("fail");
  });

  it.each([
    [{ "Authentication-Results": "mx.example; dmarc=pass header.from=portal.example" }],
    [{ "authentication-results": "MX.EXAMPLE; spf=pass; dmarc=pass header.from=Portal.Example" }],
    [
      {
        "Authentication-Results": "mx.example 1; dkim=pass; dmarc=pass header.from=portal.example",
      },
    ],
    [
      {
        "Authentication-Results": [
          "mx.example; dmarc=pass header.from=portal.example",
          "mx.otro; dmarc=fail",
        ],
      },
    ],
  ])("aligned con %j", (headers) => {
    expect(verdict(headers)).toBe("aligned");
  });

  // Los casos que antes daban `aligned` con un encabezado que escribe quien envía
  it.each([
    ["encabezado sin resultado del receptor propio", { "Authentication-Results": "x; dmarc=pass" }],
    [
      "authserv-id ajeno",
      { "Authentication-Results": "otro.example; dmarc=pass header.from=portal.example" },
    ],
    ["dmarc=pass sin header.from", { "Authentication-Results": "mx.example; dmarc=pass" }],
    [
      "DKIM de otro dominio",
      { "Authentication-Results": "mx.example; dkim=pass header.d=otro.example" },
    ],
    [
      "DKIM del mismo dominio sin DMARC",
      { "Authentication-Results": "mx.example; dkim=pass header.d=portal.example" },
    ],
    ["SPF de otro dominio", { "Received-SPF": "pass (otro.example)" }],
    ["SPF fallido suelto", { "Received-SPF": "fail (portal.example)" }],
    [
      "segunda instancia con pass",
      {
        "Authentication-Results": [
          "mx.example; dmarc=none",
          "mx.example; dmarc=pass header.from=portal.example",
        ],
      },
    ],
    [
      "primera instancia ajena y segunda propia",
      {
        "Authentication-Results": [
          "otro.example; dmarc=pass header.from=portal.example",
          "mx.example; dmarc=pass header.from=portal.example",
        ],
      },
    ],
  ])("no es aligned: %s", (_, headers) => {
    expect(verdict(headers)).not.toBe("aligned");
  });

  it.each([
    [null],
    [undefined],
    [{}],
    [{ Subject: "dmarc=fail" }],
    [{ "Authentication-Results": "mx.example; dmarc=none" }],
    [{ "DKIM-Signature": "v=1; d=portal.example" }],
  ])("none con %j", (headers) => {
    expect(verdict(headers)).toBe("none");
  });

  it("sin authserv-id configurado el veredicto es none, aunque el email pase", () => {
    const headers = {
      "Authentication-Results": "mx.example; dmarc=pass header.from=portal.example",
    };
    expect(authResultsVerdict(headers, undefined, FROM)).toBe("none");
    expect(authResultsVerdict(headers, "  ", FROM)).toBe("none");
  });

  it("con un From ilegible el veredicto es none", () => {
    const headers = {
      "Authentication-Results": "mx.example; dmarc=pass header.from=portal.example",
    };
    expect(authResultsVerdict(headers, ID, "sin direccion")).toBe("none");
  });

  describe("encabezados hostiles", () => {
    const CI_FACTOR = process.env.CI ? 4 : 1;
    const elapsed = (fn: () => unknown) => {
      const start = performance.now();
      fn();
      return performance.now() - start;
    };
    const MB2 = 2 * 1024 * 1024;

    it.each([
      ["espacios", `mx.example;${" ".repeat(MB2)}dmarc=pass`],
      ["punto y coma", `mx.example${";".repeat(MB2)}`],
      ["header.from repetido", `mx.example; dmarc=pass ${"header.from=".repeat(MB2 / 12)}`],
    ])("2 MB de %s vuelven en menos de 100 ms", (_, value) => {
      let out: unknown;
      expect(elapsed(() => (out = verdict({ "Authentication-Results": value })))).toBeLessThan(
        100 * CI_FACTOR,
      );
      expect(out).not.toBe("aligned");
    });

    it("una lista enorme de encabezados vuelve en menos de 100 ms", () => {
      const many = Array.from({ length: 100_000 }, () => "mx.example; dmarc=none");
      expect(elapsed(() => verdict({ "Authentication-Results": many }))).toBeLessThan(
        100 * CI_FACTOR,
      );
    });
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
