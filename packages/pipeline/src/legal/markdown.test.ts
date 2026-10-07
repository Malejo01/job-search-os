import { describe, expect, it } from "vitest";
import { isSafeHref, parseInline, parseLegalMarkdown } from "./markdown";

describe("isSafeHref", () => {
  it.each([
    ["https://example.com/a", true],
    ["/privacidad", true],
    ["javascript:alert(1)", false],
    ["JaVaScRiPt:alert(1)", false],
    ["data:text/html,x", false],
    ["http://example.com", false],
    ["//evil.example", false],
    ["/a b", false],
    ["mailto:a@b.c", false],
    ["/\\evil.example", false],
    ["https://example.com/a\\b", false],
  ])("%s -> %s", (href, ok) => {
    expect(isSafeHref(href)).toBe(ok);
  });
});

describe("parseInline", () => {
  it("negrita, código y link permitido", () => {
    expect(parseInline("a **b** `c` [d](/x)")).toEqual([
      { type: "text", text: "a " },
      { type: "strong", children: [{ type: "text", text: "b" }] },
      { type: "text", text: " " },
      { type: "code", text: "c" },
      { type: "text", text: " " },
      { type: "link", href: "/x", children: [{ type: "text", text: "d" }] },
    ]);
  });

  it("rechaza links javascript: y deja solo el texto", () => {
    const nodes = parseInline("[clic](javascript:alert(1))");
    expect(JSON.stringify(nodes)).not.toContain("javascript");
    expect(nodes.some((n) => n.type === "link")).toBe(false);
  });

  it("no interpreta HTML: queda como texto", () => {
    expect(parseInline("<script>x</script>")).toEqual([
      { type: "text", text: "<script>x</script>" },
    ]);
  });

  it("escapes con barra invertida", () => {
    expect(parseInline("\\*\\*no\\*\\*")).toEqual([{ type: "text", text: "**no**" }]);
  });

  it("marcadores sin cerrar quedan como texto", () => {
    expect(parseInline("a **b")).toEqual([{ type: "text", text: "a **b" }]);
  });
});

describe("parseLegalMarkdown", () => {
  it("frontmatter, títulos, párrafos y listas", () => {
    const doc = parseLegalMarkdown(
      "---\nactualizado: 2026-10-07\n---\n# T\n\nuna\nlínea\n\n- a\n- b\n\n1. x\n2. y\n\n## S\n",
    );
    expect(doc.meta.actualizado).toBe("2026-10-07");
    expect(doc.blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "list",
      "list",
      "heading",
    ]);
    const p = doc.blocks[1]!;
    expect(p.type === "paragraph" && p.children).toEqual([{ type: "text", text: "una línea" }]);
    const ol = doc.blocks[3]!;
    expect(ol.type === "list" && ol.ordered && ol.items.length).toBe(2);
  });

  it("tablas simples, con celda faltante y pipe escapado", () => {
    const doc = parseLegalMarkdown("| A | B |\n|---|---|\n| 1 | 2 \\| 3 |\n| solo |\n");
    const t = doc.blocks[0]!;
    expect(t.type).toBe("table");
    if (t.type !== "table") return;
    expect(t.header).toHaveLength(2);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]![1]).toEqual([{ type: "text", text: "2 | 3" }]);
    expect(t.rows[1]![1]).toEqual([]);
  });

  it("sin frontmatter y con CRLF", () => {
    const doc = parseLegalMarkdown("# T\r\n\r\ntexto\r\n");
    expect(doc.meta).toEqual({});
    expect(doc.blocks).toHaveLength(2);
  });

  it.each(["# \n", "## ", "### \nx", "- ", "1. ", "|", "   \n  \n", "> ", ">", "| a |\n"])(
    "termina con entradas degeneradas %j",
    (src) => {
      expect(parseLegalMarkdown(src).blocks.length).toBeGreaterThanOrEqual(0);
    },
  );

  it("un título vacío cuenta como párrafo, no se pierde ni cuelga", () => {
    const doc = parseLegalMarkdown("# \n");
    expect(doc.blocks).toEqual([{ type: "paragraph", children: [{ type: "text", text: "#" }] }]);
  });

  it("citas con >", () => {
    const doc = parseLegalMarkdown("> **Borrador** uno\n> dos\n\ntexto\n");
    expect(doc.blocks.map((b) => b.type)).toEqual(["quote", "paragraph"]);
    const q = doc.blocks[0]!;
    expect(q.type === "quote" && q.children[0]).toEqual({
      type: "strong",
      children: [{ type: "text", text: "Borrador" }],
    });
  });

  it("una línea con | que no es tabla es párrafo", () => {
    const doc = parseLegalMarkdown("a | b\n");
    expect(doc.blocks[0]!.type).toBe("paragraph");
  });
});
