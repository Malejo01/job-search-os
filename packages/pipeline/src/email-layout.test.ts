import { describe, expect, it } from "vitest";
import { BRAND, BRAND_COLORS } from "./brand";
import { brandedEmailHtml, escapeEmailHtml, textToEmailHtml } from "./email-layout";
import { emailMascotaHtml } from "./mascota";

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

  it("la mascota es opcional: con mascotAppUrl suma una sola imagen absoluta con alt", () => {
    const withMascot = brandedEmailHtml({
      bodyHtml: "<p>Hola</p>",
      mascotAppUrl: "https://x.test",
    });
    expect(withMascot.match(/<img\b/g)).toHaveLength(1);
    expect(withMascot).toContain("https://x.test/mascota/saludando-512.png");
    expect(withMascot.indexOf("<img")).toBeLessThan(withMascot.indexOf("<p>Hola</p>"));
    expect(brandedEmailHtml({ bodyHtml: "x", mascotAppUrl: "javascript:alert(1)" })).not.toMatch(
      /<img\b/,
    );
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

describe("compatibilidad con clientes de correo (R28-11)", () => {
  const html = brandedEmailHtml({
    bodyHtml: "<p>Hola</p>",
    mascotAppUrl: "https://x.test",
    preheader: "Resumen",
  });

  it("declara el esquema claro para los clientes que oscurecen (meta y style)", () => {
    expect(html).toContain('<meta name="color-scheme" content="light only">');
    expect(html).toContain('<meta name="supported-color-schemes" content="light only">');
    expect(html).toMatch(/<style>:root\{color-scheme:light only;/);
  });

  it("cada bloque de color lleva bgcolor de respaldo además del estilo en línea", () => {
    for (const color of [BRAND_COLORS.canvas, BRAND_COLORS.ink, BRAND_COLORS.white]) {
      expect(html).toContain(`bgcolor="${color}"`);
    }
    expect(html).toMatch(/<body bgcolor="#EEEDF9"/);
  });

  it("solo tablas de maquetación, sin scripts, hojas, @import ni fondos remotos", () => {
    expect(html).not.toMatch(/<script\b|<link\b|@import|url\(|<iframe\b|<form\b/i);
    expect(html).toMatch(/<table role="presentation"/);
    // la única hoja es el <style> de una línea del esquema de color
    expect(html.match(/<style>/g)).toHaveLength(1);
  });

  it("la mascota: imagen con tamaño, alt y estilo de respaldo, sobre una celda con fondo propio", () => {
    const img = html.match(/<img\b[^>]*>/)?.[0] ?? "";
    expect(img).toMatch(/width="94"/);
    expect(img).toMatch(/height="160"/);
    expect(img).toMatch(/alt="[^"]{5,}"/);
    expect(img).toContain('border="0"');
    expect(img).toContain("display:block");
    expect(img).toMatch(/color:#1E1B4B/);
    expect(html).toMatch(/<td align="center" bgcolor="#EEEDF9"[^>]*>\s*<img\b/);
  });

  it("el HTML de la mascota no cambia sin que alguien lo note (snapshot)", () => {
    expect(emailMascotaHtml("https://x.test/", "Marca X")).toMatchInlineSnapshot(
      `"<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;"><tr><td align="center" bgcolor="#EEEDF9" style="background-color:#EEEDF9;border-radius:20px;padding:12px 20px;"><img src="https://x.test/mascota/saludando-512.png" alt="Afi, la mascota de Marca X, saluda con la mano" width="94" height="160" border="0" style="display:block;border:0;outline:none;text-decoration:none;width:94px;height:160px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.3;color:#1E1B4B;"></td></tr></table>"`,
    );
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
