import { describe, expect, it } from "vitest";
import { docxXmlToText } from "./docx-text";

const doc = (body: string): string =>
  `<w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`;

describe("docxXmlToText", () => {
  it("separa párrafos con salto de línea", () => {
    const xml = doc(
      "<w:p><w:r><w:t>Persona Ficticia</w:t></w:r></w:p><w:p><w:r><w:t>Desarrolladora</w:t></w:r></w:p>",
    );
    expect(docxXmlToText(xml)).toEqual({ ok: true, value: "Persona Ficticia\nDesarrolladora\n" });
  });

  it("une los runs de un mismo párrafo y respeta xml:space", () => {
    const xml = doc(
      '<w:p><w:r><w:t xml:space="preserve">Hola </w:t></w:r><w:r><w:t>mundo</w:t></w:r></w:p>',
    );
    expect(docxXmlToText(xml)).toEqual({ ok: true, value: "Hola mundo\n" });
  });

  it("tabs, saltos y celdas de tabla", () => {
    const xml = doc(
      "<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t></w:r></w:p>" +
        "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>y</w:t></w:r></w:p></w:tc></w:tr></w:tbl>",
    );
    const r = docxXmlToText(xml);
    expect(r).toEqual({ ok: true, value: "a\tb\nc\n\tx\n\ty\n" });
  });

  it("w:tbl, w:tr y w:tcPr no se confunden con w:t ni w:tc", () => {
    const xml = doc(
      "<w:tbl><w:tblPr/><w:tr><w:trPr/><w:tc><w:tcPr/><w:p><w:r><w:t>z</w:t></w:r></w:p></w:tc></w:tr></w:tbl>",
    );
    expect(docxXmlToText(xml)).toEqual({ ok: true, value: "\tz\n" });
  });

  it("decodifica las 5 entidades y referencias numéricas", () => {
    const xml = doc(
      "<w:p><w:r><w:t>&lt;a&gt; &amp; &quot;b&quot; &apos;c&apos; &#65;&#x42; &#xE1;</w:t></w:r></w:p>",
    );
    expect(docxXmlToText(xml)).toEqual({ ok: true, value: "<a> & \"b\" 'c' AB á\n" });
  });

  it("ignora referencias numéricas inválidas y entidades no predefinidas", () => {
    const xml = doc("<w:p><w:r><w:t>a&#0;b&#xD800;c&foo;d</w:t></w:r></w:p>");
    expect(docxXmlToText(xml)).toEqual({ ok: true, value: "abc&foo;d\n" });
  });

  it("rechaza DOCTYPE y ENTITY", () => {
    const evil = '<!DOCTYPE x [<!ENTITY a "boom">]>' + doc("<w:p><w:r><w:t>&a;</w:t></w:r></w:p>");
    expect(docxXmlToText(evil)).toEqual({ ok: false, error: "doctype_forbidden" });
    expect(docxXmlToText("<!ENTITY a 'b'>" + doc(""))).toEqual({
      ok: false,
      error: "doctype_forbidden",
    });
  });

  it("incluye cajas de texto sin duplicar el fallback", () => {
    const xml = doc(
      "<mc:AlternateContent><mc:Choice><w:txbxContent><w:p><w:r><w:t>Caja</w:t></w:r></w:p></w:txbxContent></mc:Choice>" +
        "<mc:Fallback><w:txbxContent><w:p><w:r><w:t>Caja</w:t></w:r></w:p></w:txbxContent></mc:Fallback></mc:AlternateContent>",
    );
    expect(docxXmlToText(xml)).toEqual({ ok: true, value: "Caja\n" });
  });

  it("sin texto es empty", () => {
    expect(docxXmlToText(doc("<w:p/>"))).toEqual({ ok: false, error: "empty" });
  });
});
