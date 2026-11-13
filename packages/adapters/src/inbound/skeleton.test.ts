import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadPatterns } from "../../../../scripts/privacy-scan.mjs";
import {
  buildSkeletons,
  maskHost,
  maskHtmlText,
  maskShape,
  maskUrl,
  parseEml,
  registrableDomain,
  sanitizeCss,
  type SkeletonResult,
} from "./skeleton";

/**
 * Esqueletos de .eml (R8-1a). Los .eml son inventados (Empresa A…, Ficticia) y los patrones de
 * privacidad también: el repo público no trae los reales.
 */
const FIXTURES = join(__dirname, "fixtures", "skeleton");
const tmp: string[] = [];

afterAll(() => {
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
});

const eml = (name: string): string => readFileSync(join(FIXTURES, name)).toString("latin1");

function patterns(text = "Empresa Reservada\n") {
  const dir = mkdtempSync(join(tmpdir(), "skel-pats-"));
  tmp.push(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "privacy-patterns.txt"), text);
  return loadPatterns(dir);
}

function okHtml(r: SkeletonResult | undefined): string {
  if (!r || !r.ok) throw new Error("se esperaba un esqueleto");
  return r.html;
}

const PORTAL = ["bolsa-demo.example"];
const A = () => eml("alerta-a.eml");
const B = () => eml("alerta-b.eml");

describe("enmascarado por forma", () => {
  it("letras a x/X, dígitos a 9, el resto igual", () => {
    expect(maskShape("Hola María, 3 años (ABC-12)!")).toBe("Xxxx Xxxxx, 9 xxxx (XXX-99)!");
  });

  it("las entidades con letras se enmascaran; las de espacio y signos se dejan", () => {
    expect(maskHtmlText("Mar&iacute;a&nbsp;&amp;&nbsp;Jos&#233; &#8226;")).toBe(
      "Xxxxx&nbsp;&amp;&nbsp;Xxxx &#8226;",
    );
  });

  it("un link pierde ids y tokens: conserva host y nombres de parámetros", () => {
    const m = maskUrl(
      "https://www.bolsa-demo.example/empleos/dev-123456?utm_source=mail&amp;token=abc123DEF#seccion",
      { clearHosts: ["bolsa-demo.example"] },
    );
    expect(m).toBe(
      "https://www.bolsa-demo.example/xxxxxxx/xxx-999999?utm_source=xxxx&amp;token=xxx999XXX#xxxxxxx",
    );
  });

  it("hosts: en claro solo los del portal; terceros conocidos sin lo de la izquierda; el resto sin labels", () => {
    const ctx = { clearHosts: ["bolsa-demo.example"] };
    expect(maskHost("logos.bolsa-demo.example", ctx)).toBe("logos.bolsa-demo.example");
    // Un host de empresa no puede salir en claro: queda solo el TLD
    expect(maskHost("logos.empresa-x.com", ctx)).toBe("xxxxx.xxxxxxx-x.com");
    expect(maskHost("logos.empresa-x.com")).toBe("xxxxx.xxxxxxx-x.com");
    // Infraestructura conocida: el dominio sí, lo que tenga a la izquierda no
    expect(maskHost("empresa-x.s3.amazonaws.com")).toBe("xxxxxxx-x.x9.amazonaws.com");
    expect(maskHost("click.mailchimp.com")).toBe("xxxxx.mailchimp.com");
    // «notbolsa-demo.example» no es un subdominio del portal
    expect(maskHost("notbolsa-demo.example", ctx)).toBe("xxxxxxxx-xxxx.example");
    // Sin TLD reconocible: todo por forma
    expect(maskHost("10.0.0.1")).toBe("99.9.9.9");
    expect(maskUrl("https://logos.empresa-x.com/a.png", ctx)).toBe(
      "https://xxxxx.xxxxxxx-x.com/x.xxx",
    );
  });

  it("host con usuario, esquemas raros y mailto se enmascaran", () => {
    expect(maskUrl("https://usuario:clave@host.example/x")).not.toContain("usuario");
    expect(maskUrl("javascript:alert('Ficticia')")).toBe("xxxxxxxxxx:xxxxx('Xxxxxxxx')");
    const mail = maskUrl("mailto:ayuda@bolsa-demo.example");
    expect(mail).toMatch(/^mailto:x+@x+-x+\.x+$/);
    expect(mail).not.toContain("ayuda");
    expect(maskUrl("https://u1234567.ct.example.net/a", { clearHosts: ["example.net"] })).toBe(
      "https://x9999999.ct.example.net/x",
    );
  });

  it("el CSS pierde url() y cadenas, y conserva la forma", () => {
    const css = sanitizeCss(
      ".a{width:600px;background:url('https://x.example/5.png');content:'Hola'}",
    );
    expect(css).toBe(".a{width:600px;background:url('xxxxx://x.xxxxxxx/9.xxx');content:'Xxxx'}");
  });

  it("dominio registrable", () => {
    expect(registrableDomain("mail.bolsa-demo.com.ar")).toBe("bolsa-demo.com.ar");
    expect(registrableDomain("mail.bolsa-demo.com")).toBe("bolsa-demo.com");
  });
});

describe("parseEml", () => {
  it("multipart: toma la parte HTML y deja afuera el texto plano", () => {
    const p = parseEml(A());
    expect(p.htmlParts).toHaveLength(1);
    expect(p.htmlParts[0]).toContain("<table");
    expect(p.htmlParts[0]).not.toContain("tenes avisos nuevos");
  });

  it("quoted-printable con charset utf-8 y asunto RFC 2047", () => {
    const p = parseEml(B());
    expect(p.htmlParts[0]).toContain("Diseñadora Ficticia");
    expect(p.htmlParts[0]).toContain('href="https://www.bolsa-demo.example/empleos/disenadora');
    expect(p.subject).toBe("Un aviso nuevo para Ficticia");
  });

  it("base64", () => {
    const html = "<p>Hola</p>";
    const raw = `Content-Type: text/html; charset=utf-8\nContent-Transfer-Encoding: base64\n\n${Buffer.from(html).toString("base64")}\n`;
    expect(parseEml(raw).htmlParts).toEqual([html]);
  });
});

describe("buildSkeletons", () => {
  const inputs = () => [
    { id: 1, raw: A() },
    { id: 2, raw: B() },
  ];

  it("conserva el texto de plantilla y enmascara el variable", () => {
    const { results } = buildSkeletons(inputs(), { patterns: patterns() });
    const html = okHtml(results[0]);
    expect(html).toContain(">Ver aviso</a>");
    expect(html).toContain("<title>Alertas de empleo</title>");
    // Mezclado con una dirección de email, el texto no es de plantilla
    expect(html).not.toContain("Cancelar suscripcion");
    // Variable: título y empresa, solo con su forma
    expect(html).not.toContain("Desarrollador");
    expect(html).toContain(">Xxxxxxxxxxxxx Xxxxxxx Xxxxxxxx</a>");
    expect(html).toContain('<td class="empresa">Xxxxxxx X</td>');
    // El saludo nunca es plantilla aunque se repita en los dos emails
    expect(html).not.toContain("Hola Ficticia");
    expect(html).toContain("Xxxx Xxxxxxxx,");
  });

  it("no deja nada de lo variable: ni nombres, ni ids, ni tokens, ni emails", () => {
    const { results } = buildSkeletons(inputs(), { patterns: patterns() });
    for (const r of results) {
      const html = okHtml(r);
      for (const leak of [
        "Ficticia",
        "ficticia",
        "Perez",
        "123456",
        "654321",
        "abc123DEF",
        "987654321",
        "contacto@",
        "889977",
        "secreto",
        "comentario",
      ]) {
        expect(html).not.toContain(leak);
      }
      // Si queda algo con «@», es una dirección enmascarada (solo x, X y 9)
      expect(html).not.toMatch(/[^xX9._\s-]@|@[^xX9._-]/);
    }
  });

  it("conserva la estructura: etiquetas y atributos estructurales; saca comentarios y script", () => {
    const html = okHtml(
      buildSkeletons(inputs(), { patterns: patterns(), portalDomains: PORTAL }).results[0],
    );
    expect(html).toContain(
      '<table role="presentation" width="600" align="center" class="contenedor">',
    );
    expect(html).toContain('<a class="boton" href="https://www.bolsa-demo.example/');
    expect(html).toContain("token=xxx999XXX");
    expect(html).toContain('width="1" height="1" alt="Xxxxx xx Xxxxxxxx"');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<!--");
    expect(html).not.toContain("From:");
  });

  it("el resumen cuenta links al portal, bloques repetidos y JSON-LD; sin datos del remitente", () => {
    const { resumen } = buildSkeletons(inputs(), { patterns: patterns(), portalDomains: PORTAL });
    expect(resumen).toContain("dominios del portal: bolsa-demo.example");
    expect(resumen).toContain("links: 4 en total, 4 a dominios del portal");
    expect(resumen).toContain("JSON-LD: sí (tipos: ItemList)");
    expect(resumen).toContain("<table> × 2, 8 etiquetas *");
    expect(resumen).toContain("mail.bolsa-demo.example · parte local: alertas");
    expect(resumen).toContain("asunto (enmascarado): 9 xxxxxx xxxxxx xxxx Xxxxxxxx");
    expect(resumen).not.toContain("Ficticia");
  });

  it("sin --portal ningún host sale en claro, pero los links se cuentan con el dominio del remitente", () => {
    const { results, resumen } = buildSkeletons(inputs(), { patterns: patterns() });
    const html = okHtml(results[0]);
    expect(html).not.toContain("bolsa-demo");
    expect(html).toContain('href="https://xxx.xxxxx-xxxx.example/');
    expect(resumen).not.toContain("bolsa-demo");
    expect(resumen).toContain("dominios del portal: xxxxx-xxxx.example");
    expect(resumen).toContain("links: 4 en total, 4 a dominios del portal");
  });

  it("class e id: solo el vocabulario estructural sale en claro; lo demás, por forma", () => {
    const raw = [
      "Content-Type: text/html",
      "",
      '<div class="container col-6 card-body ExternalClass" id="job-title">',
      '<span class="empresa-acme logo-acme job_12345 a1b2c3d4e5f6a7b8c9d0e1f2 aviso-card"></span></div>',
    ].join("\n");
    const html = okHtml(buildSkeletons([{ id: 1, raw }], { patterns: patterns() }).results[0]);
    expect(html).toContain('<div class="container col-6 card-body ExternalClass" id="job-title">');
    expect(html).toContain(
      '<span class="xxxxxxx-xxxx xxxx-xxxx xxx_99999 x9x9x9x9x9x9x9x9x9x9x9x9 aviso-card">',
    );
    expect(html).not.toMatch(/acme|a1b2c3/);
  });

  it("--portal reemplaza el dominio por defecto", () => {
    const { resumen } = buildSkeletons(inputs(), {
      patterns: patterns(),
      portalDomains: ["otro.example"],
    });
    expect(resumen).toContain("links: 4 en total, 0 a dominios del portal");
  });

  it("con keepTemplateText=false no se conserva ningún texto", () => {
    const html = okHtml(
      buildSkeletons(inputs(), { patterns: patterns(), keepTemplateText: false }).results[0],
    );
    expect(html).not.toContain("Ver aviso");
    expect(html).toContain(">Xxx xxxxx</a>");
  });

  it("un texto de plantilla que coincide con un patrón se enmascara, no se conserva", () => {
    const withText = B().replace("<tr><td>Empresa Reservada</td></tr>", "");
    const twice = [
      { id: 1, raw: B() },
      {
        id: 2,
        raw: withText.replace(
          "</table>\n</body>",
          "<tr><td>Empresa Reservada</td></tr></table>\n</body>",
        ),
      },
    ];
    const { results } = buildSkeletons(twice, { patterns: patterns() });
    const html = okHtml(results[0]);
    expect(html).not.toContain("Reservada");
    expect(html).toContain("<td>Xxxxxxx Xxxxxxxxx</td>");
  });

  it("un patrón que coincide en lo que se conserva bloquea la salida y se informa por número", () => {
    // El host del portal sale en claro (--portal): si coincide con un patrón, no se escribe
    const { results, resumen } = buildSkeletons(
      [{ id: 3, raw: eml("alerta-c-clase-reservada.eml") }],
      { patterns: patterns(), portalDomains: ["empresa-reservada.example"] },
    );
    const c = results[0]!;
    expect(c.ok).toBe(false);
    if (!c.ok) {
      expect(c.reason).toContain("patrón n.º 1");
      expect(c.reason).not.toMatch(/reservada/i);
    }
    expect(resumen).toContain("BLOQUEADO, sin esqueleto");
    expect(resumen).not.toMatch(/reservada/i);
  });

  it("sin --portal, el mismo host y la clase quedan enmascarados y el email sale", () => {
    const { results } = buildSkeletons([{ id: 3, raw: eml("alerta-c-clase-reservada.eml") }], {
      patterns: patterns(),
    });
    const html = okHtml(results[0]);
    expect(html).not.toMatch(/reservada/i);
    expect(html).toContain('<table class="aviso xxxxxxx-xxxxxxxxx">');
    expect(html).toContain('href="https://xxx.xxxxxxx-xxxxxxxxx.example/xxx"');
  });

  it("sin patrones falla cerrado: no emite nada", () => {
    expect(() => buildSkeletons(inputs(), { patterns: [] })).toThrow(/sin patrones/);
  });

  it("HTML mal formado falla cerrado", () => {
    const raw = 'Content-Type: text/html\n\n<table><tr><td class="x>Cargo Ficticio';
    const r = buildSkeletons([{ id: 1, raw }], { patterns: patterns() }).results[0]!;
    expect(r.ok).toBe(false);
  });

  it("un email sin parte HTML queda afuera", () => {
    const raw = "Content-Type: text/plain\n\nHola Ficticia";
    const r = buildSkeletons([{ id: 1, raw }], { patterns: patterns() }).results[0]!;
    expect(r).toEqual({ id: 1, ok: false, reason: "el email no tiene parte HTML" });
  });

  it("un remitente con parte local no genérica se enmascara", () => {
    const raw =
      "From: Ficticia Perez <ficticia.perez@empresa-ficticia.example>\nContent-Type: text/html\n\n<p>x</p>";
    const { resumen } = buildSkeletons([{ id: 1, raw }], { patterns: patterns() });
    // El dominio del remitente tampoco sale en claro si no es un --portal
    expect(resumen).toContain("xxxxxxx-xxxxxxxx.example · parte local: xxxxxxxx.xxxxx");
    expect(resumen).not.toContain("empresa-ficticia");
    expect(resumen).not.toContain("ficticia.perez");
  });
});
