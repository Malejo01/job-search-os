import { describe, expect, it } from "vitest";
import { BRAND, BRAND_COLORS } from "./brand";
import { brandedEmailHtml, escapeEmailHtml, textToEmailHtml } from "./email-layout";

describe("brandedEmailHtml (C7-2)", () => {
  const html = brandedEmailHtml({ bodyHtml: "<p>Hola</p>" });

  it("lleva el logotipo AfinIA/Jobs con los colores de marca sobre tinta", () => {
    expect(html).toContain(BRAND.wordmark.strong);
    expect(html).toContain(BRAND.wordmark.light);
    expect(html).toContain(BRAND_COLORS.ink);
    expect(html).toContain(BRAND_COLORS.accent);
    expect(html).toContain("<p>Hola</p>");
  });

  it("no pide nada por red: sin imágenes ni hojas de estilo remotas", () => {
    expect(html).not.toMatch(/<img\b/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/url\(/i);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("el pie lleva el nombre y la bajada", () => {
    expect(html).toContain(BRAND.name);
    expect(html).toContain(BRAND.tagline);
  });

  it("el preencabezado oculto se escapa", () => {
    const withPre = brandedEmailHtml({ bodyHtml: "<p>x</p>", preheader: "<b>vence</b>" });
    expect(withPre).toContain("&lt;b&gt;vence&lt;/b&gt;");
    expect(withPre).not.toContain("<b>vence</b>");
  });
});

describe("textToEmailHtml", () => {
  it("escapa el HTML y separa párrafos por línea en blanco", () => {
    const out = textToEmailHtml("Hola <Ana>:\n\nSegunda línea\ny tercera");
    expect(out).toContain("Hola &lt;Ana&gt;:");
    expect(out.match(/<p /g)).toHaveLength(2);
    expect(out).toContain("Segunda línea<br>y tercera");
  });

  it("convierte solo las URLs http(s) en links, con naranja profundo", () => {
    const out = textToEmailHtml("Pagá acá: https://mpago.la/abc?x=1&y=2");
    expect(out).toContain('<a href="https://mpago.la/abc?x=1&amp;y=2"');
    expect(out).toContain(BRAND_COLORS.accentDeep);
    expect(textToEmailHtml("javascript:alert(1)")).not.toContain("<a ");
  });

  it("un link con comillas no rompe el atributo", () => {
    const out = textToEmailHtml('https://x.example.com/"onmouseover="y');
    expect(out).not.toContain('"onmouseover="');
  });
});

describe("escapeEmailHtml", () => {
  it("escapa los cinco caracteres", () => {
    expect(escapeEmailHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });
});
