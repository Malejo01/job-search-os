import { describe, expect, it } from "vitest";
import { removeBlocks, stripScripts, stripTags, tagBlocks } from "./html-scan";
import {
  classifyInbound,
  gmailConfirmLink,
  gmailForwardRequester,
  htmlToText,
} from "./inbound-classify";

const MB2 = 2 * 1024 * 1024;
/** Las máquinas del CI son más lentas y compartidas: el margen evita falsos rojos. */
const LIMIT_MS = process.env.CI ? 400 : 100;

/** Corre `fn` y devuelve los milisegundos que tardó. */
function elapsed(fn: () => unknown): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

describe("stripTags", () => {
  it.each([
    ["<p>hola</p>", " hola "],
    ["a<br/>b", "a b"],
    ["<<a>b", " b"],
    ["a<>b", "a<>b"],
    ["a < b", "a < b"],
    ["sin cierre <a href", "sin cierre <a href"],
  ])("%s", (html, expected) => {
    expect(stripTags(html)).toBe(expected);
    expect(stripTags(html)).toBe(html.replace(/<[^>]+>/g, " "));
  });

  it("acepta un reemplazo según la etiqueta", () => {
    expect(stripTags("a<br>b<i>c", (tag) => (tag === "<br>" ? "\n" : ""))).toBe("a\nbc");
  });
});

describe("stripScripts", () => {
  it.each([
    ["a<script>x</script>b<style>y</style>c", "a b c"],
    ["a<SCRIPT src=x>y</SCRIPT>b", "a b"],
    ["a<script>sin cierre", "a<script>sin cierre"],
    ["<script>sin cierre<style>y</style>z", "<script>sin cierre z"],
  ])("%s", (html, expected) => {
    expect(stripScripts(html)).toBe(expected);
    expect(stripScripts(html)).toBe(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " "));
  });
});

describe("tagBlocks", () => {
  it("devuelve atributos, contenido y posición", () => {
    const html = 'x<a href="1">uno</a>y<A HREF="2">dos</A>';

    expect(tagBlocks(html, "a", { boundary: "space" })).toEqual([
      { attrs: ' href="1"', inner: "uno", start: 1, end: 20 },
      { attrs: ' HREF="2"', inner: "dos", start: 21, end: 40 },
    ]);
  });

  it("filtra por atributos sin consumir el bloque descartado", () => {
    const html = '<td class="a">uno<td class="b">dos</td>';
    const blocks = tagBlocks(html, "td", { attrs: (a) => a.includes('"b"') });

    expect(blocks.map((b) => b.inner)).toEqual(["dos"]);
  });

  it("corta en el límite pedido", () => {
    expect(tagBlocks("<p>1</p><p>2</p><p>3</p>", "p", { limit: 2 })).toHaveLength(2);
  });

  it("sin cierre no devuelve el bloque", () => {
    expect(tagBlocks("<a >uno<a >dos", "a", { boundary: "space" })).toEqual([]);
  });

  it("respeta el borde de la etiqueta", () => {
    expect(tagBlocks("<pre>1</pre><p>2</p>", "p", { boundary: "spaceOrClose" })).toHaveLength(1);
  });
});

describe("removeBlocks", () => {
  it("saca los bloques y deja el resto", () => {
    expect(removeBlocks("a<span x>b</span>c", "span", " ")).toBe("a c");
  });
});

describe("tiempo con 2 MB hostiles", () => {
  const HOSTILE: [string, string][] = [
    ["aperturas de etiqueta", "<".repeat(MB2)],
    ["<a sin cierre", "<a ".repeat(MB2 / 3)],
    ["<a > sin cierre", "<a >".repeat(MB2 / 4)],
    ["<script sin cierre", "<script>".repeat(MB2 / 8)],
    ["arrobas", "a@".repeat(MB2 / 2)],
    ["corrida sin arroba", "a".repeat(MB2)],
    ["puntos después de un link", `https://mail.google.com/${".".repeat(MB2)}x`],
  ];

  it.each(HOSTILE)("htmlToText con %s", (_, input) => {
    expect(elapsed(() => htmlToText(input))).toBeLessThan(LIMIT_MS);
  });

  it.each(HOSTILE)("gmailForwardRequester con %s", (_, input) => {
    expect(elapsed(() => gmailForwardRequester(input, null))).toBeLessThan(LIMIT_MS);
  });

  it.each(HOSTILE)("gmailConfirmLink con %s", (_, input) => {
    expect(elapsed(() => gmailConfirmLink(input, null))).toBeLessThan(LIMIT_MS);
  });

  it.each(HOSTILE)("tagBlocks con %s", (_, input) => {
    expect(elapsed(() => tagBlocks(input, "a", { boundary: "space" }))).toBeLessThan(LIMIT_MS);
  });
});

describe("classifyInbound con un asunto de 2 MB", () => {
  it.each([
    ["una palabra repetida", "verify".repeat(MB2 / 6)],
    ["espacios", " ".repeat(MB2)],
    ["dígitos", "1".repeat(MB2)],
  ])("%s", (_, subject) => {
    const run = () => classifyInbound({ from: "alertas@example.com", subject, text: null });

    expect(elapsed(run)).toBeLessThan(LIMIT_MS);
  });

  it("un asunto normal se sigue clasificando", () => {
    const { category } = classifyInbound({
      from: "alertas@example.com",
      subject: "Tu código de verificación",
      text: null,
    });

    expect(category).toBe("seguridad");
  });
});

describe("gmailForwardRequester", () => {
  it.each([
    ["ana.perez@example.com has requested to automatically forward", "ana.perez@example.com"],
    ["(ana@example.com) ha solicitado reenviar", "ana@example.com"],
    ["ANA@Example.COM solicitó el reenvío", "ana@example.com"],
    ["hola ana+alertas@mail.example.com   has requested", "ana+alertas@mail.example.com"],
  ])("lee la cuenta de %s", (text, account) => {
    expect(gmailForwardRequester(text, null)).toBe(account);
  });

  it("lee la cuenta del HTML y del asunto", () => {
    expect(gmailForwardRequester(null, "<p>ana@example.com has requested</p>")).toBe(
      "ana@example.com",
    );
    expect(gmailForwardRequester(null, null, "Receive Mail from ana@example.com")).toBe(
      "ana@example.com",
    );
  });

  it("sin el pedido no devuelve nada", () => {
    expect(gmailForwardRequester("escribile a ana@example.com", null)).toBeNull();
  });
});

describe("gmailConfirmLink", () => {
  it("saca la puntuación del final del link", () => {
    expect(gmailConfirmLink("Abrí https://mail.google.com/mail/vf-abc.,; ya", null)).toBe(
      "https://mail.google.com/mail/vf-abc",
    );
  });
});
