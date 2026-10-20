import { describe, expect, it } from "vitest";
import {
  EMAIL_FRAME_CSP,
  MAX_EMAIL_HTML,
  buildEmailFrameDoc,
  stripNavigationTags,
} from "./email-frame";

const NAV = /<(meta|base)(?=[\s/>])/i;

describe("stripNavigationTags · meta", () => {
  const variantes: Record<string, string> = {
    minúsculas: `<meta http-equiv="refresh" content="0;url=https://example.com/x">`,
    "HTTP-EQUIV en mayúsculas": `<META HTTP-EQUIV="Refresh" CONTENT="0; URL=https://example.com/x">`,
    "comillas simples": `<meta http-equiv='refresh' content='0;url=https://example.com/x'>`,
    "sin comillas": `<meta http-equiv=refresh content=0;url=https://example.com/x>`,
    "espacios raros": `<meta   \n http-equiv \t = \n "refresh"\n content = "5"  />`,
    "barra en lugar de espacio": `<meta/http-equiv="refresh"/content="0;url=https://example.com/x">`,
    "comilla suelta sin cierre": `<meta a"b http-equiv=refresh content=0;url=//x>`,
  };

  for (const [nombre, tag] of Object.entries(variantes)) {
    it(`quita ${nombre}`, () => {
      const out = stripNavigationTags(`<html><head>${tag}</head><body><p>Hola</p></body></html>`);
      expect(out).toBe("<html><head></head><body><p>Hola</p></body></html>");
    });
  }

  it("una comilla abierta no esconde el meta siguiente", () => {
    const out = stripNavigationTags(`<meta name=x"> <meta content="0;url=//x" http-equiv=refresh>`);
    expect(out).not.toMatch(NAV);
    expect(out.toLowerCase()).not.toContain("<meta");
  });

  it("un > dentro de una comilla no deja una etiqueta viva", () => {
    const out = stripNavigationTags(
      `<meta content="0;url=https://example.com/?a>b" http-equiv="refresh"><p>ok</p>`,
    );
    expect(out).not.toMatch(NAV);
    expect(out).not.toMatch(/<meta/i);
    expect(out).toContain("<p>ok</p>");
  });

  it("anidado de pocos niveles: no reaparece", () => {
    const out = stripNavigationTags(
      `<me<meta http-equiv="refresh">ta http-equiv="refresh" content="0">`,
    );
    expect(out).not.toMatch(NAV);
  });

  it("anidado a 30 niveles: no queda ningún meta ni base como etiqueta", () => {
    const n = 30;
    const html = `${"<me".repeat(n)}<meta>${"ta>".repeat(n)}<p>x</p>`;
    const out = stripNavigationTags(html);
    expect(out).not.toMatch(NAV);
    expect(out).not.toContain("<meta");
  });

  it("anidado de <base> a 30 niveles", () => {
    const n = 30;
    const out = stripNavigationTags(`${"<ba".repeat(n)}<base>${"se>".repeat(n)}`);
    expect(out).not.toMatch(NAV);
  });
});

describe("stripNavigationTags · base", () => {
  it("quita <base> en el head", () => {
    const out = stripNavigationTags(
      `<head><base href="https://example.com/"></head><body><a href="x">x</a></body>`,
    );
    expect(out).toBe(`<head></head><body><a href="x">x</a></body>`);
  });

  it("quita <base> en el body, en mayúsculas y autocerrado", () => {
    const out = stripNavigationTags(
      `<body><p>a</p><BASE HREF='//example.com' target=_top /><p>b</p></body>`,
    );
    expect(out).toBe("<body><p>a</p><p>b</p></body>");
  });

  it("no confunde otras etiquetas que empiezan igual", () => {
    const html = `<basefont size="2"><metadata></metadata><p>x</p>`;
    expect(stripNavigationTags(html)).toBe(html);
  });
});

describe("stripNavigationTags · tamaño y rendimiento", () => {
  it('1 MB con miles de `<meta"` termina rápido', () => {
    const html = '<meta"'.repeat(170_000);
    const t0 = performance.now();
    const out = stripNavigationTags(html);
    expect(performance.now() - t0).toBeLessThan(300);
    expect(out).not.toMatch(NAV);
  });

  it("1 MB de <meta sin cerrar termina rápido", () => {
    const html = "<meta ".repeat(170_000);
    const t0 = performance.now();
    const out = stripNavigationTags(html);
    expect(performance.now() - t0).toBeLessThan(300);
    expect(out).not.toMatch(NAV);
  });

  it("más de 2 MB: se corta y se escapa", () => {
    const out = stripNavigationTags(`<p>${"a".repeat(MAX_EMAIL_HTML)}</p>`);
    expect(out.length).toBeLessThanOrEqual(MAX_EMAIL_HTML + 3 * 4);
    expect(out).not.toContain("<");
    expect(out.startsWith("&lt;p>")).toBe(true);
  });
});

describe("buildEmailFrameDoc", () => {
  it("la CSP sale con form-action y base-uri en none, sin relajar lo anterior", () => {
    expect(EMAIL_FRAME_CSP).toContain("form-action 'none'");
    expect(EMAIL_FRAME_CSP).toContain("base-uri 'none'");
    expect(EMAIL_FRAME_CSP).toContain("default-src 'none'");
    expect(EMAIL_FRAME_CSP).toContain("style-src 'unsafe-inline'");
    const doc = buildEmailFrameDoc("<p>x</p>");
    expect(doc).toContain(`http-equiv="Content-Security-Policy" content="${EMAIL_FRAME_CSP}"`);
    expect(doc.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true);
  });

  it("un email normal no pierde contenido (salvo los meta, que el visor repone)", () => {
    const body = `<table><tr><td><h1>Nueva oferta</h1><a href="https://example.com/o?id=1&amp;x=2">Ver</a><img src="https://example.com/i.png" alt="logo"></td></tr></table>`;
    const email = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=600"><title>Ofertas</title><style>td{color:red}</style></head><body>${body}</body></html>`;
    const out = stripNavigationTags(email);
    expect(out).toBe(
      `<!doctype html><html><head><title>Ofertas</title><style>td{color:red}</style></head><body>${body}</body></html>`,
    );
  });

  it("el HTML externo no puede dejar un refresh ni un base en el documento final", () => {
    const doc = buildEmailFrameDoc(
      `<base href="https://example.com/"><meta http-equiv="REFRESH" content="0;url=https://example.com"><p>ok</p>`,
    );
    expect(doc).not.toMatch(/<base/i);
    expect(doc).not.toMatch(/refresh/i);
    expect(doc).toContain("<p>ok</p>");
  });
});
