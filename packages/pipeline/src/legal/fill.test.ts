import { describe, expect, it } from "vitest";
import { fillLegalPlaceholders, legalMissing, legalTextIsDraft } from "./fill";
import { parseLegalMarkdown, type InlineNode } from "./markdown";

const TEXTO =
  "Responsable: **[RESPONSABLE]**, domicilio **[DOMICILIO]**, contacto [EMAIL DE CONTACTO]. " +
  "Se conservan por [A DEFINIR: plazo de retención de los logs]. [A REVISAR: art. 1]";

const COMPLETO = {
  LEGAL_RESPONSABLE: "Responsable de Prueba",
  LEGAL_DOMICILIO: "Calle Falsa 123, Ciudad de Prueba",
  LEGAL_EMAIL: "responsable@example.com",
  LEGAL_LOG_DAYS: "30",
};

const MARCADORES = /\[RESPONSABLE\]|\[DOMICILIO\]|\[EMAIL DE CONTACTO\]|plazo de retención/;

describe("fillLegalPlaceholders", () => {
  it("con todas las variables no queda ningún marcador de los cuatro", () => {
    const out = fillLegalPlaceholders(TEXTO, COMPLETO);
    expect(out).not.toMatch(MARCADORES);
    expect(out).toContain("Responsable de Prueba");
    expect(out).toContain("responsable@example.com");
    expect(out).toContain("30 días");
  });

  it("sin variables aparece 'en revisión' y ningún marcador", () => {
    const out = fillLegalPlaceholders(TEXTO, {});
    expect(out).not.toMatch(MARCADORES);
    expect(out.match(/en revisión/g)).toHaveLength(4);
    expect(out.match(/\(dato en revisión\)/g)).toHaveLength(3);
    expect(out).toContain("Se conservan por un plazo que está en revisión.");
  });

  it("una variable vacía o en blanco cuenta como ausente", () => {
    const out = fillLegalPlaceholders("[RESPONSABLE]", { LEGAL_RESPONSABLE: "   " });
    expect(out).toBe("(dato en revisión)");
  });

  it.each(["abc", "0", "-5", "3651", "12.5", "1e3", "", "30 días", "99999"])(
    "LEGAL_LOG_DAYS=%j se trata como ausente",
    (v) => {
      const out = fillLegalPlaceholders("[A DEFINIR: plazo de retención de los logs]", {
        LEGAL_LOG_DAYS: v,
      });
      expect(out).toBe("un plazo que está en revisión");
    },
  );

  it("acepta los extremos 1 y 3650", () => {
    const f = (v: string) =>
      fillLegalPlaceholders("[A DEFINIR: plazo de retención de los logs]", { LEGAL_LOG_DAYS: v });
    expect(f("1")).toBe("1 día");
    expect(f("3650")).toBe("3650 días");
  });

  it("deja como están los demás marcadores del borrador", () => {
    const out = fillLegalPlaceholders(TEXTO, COMPLETO);
    expect(out).toContain("[A REVISAR: art. 1]");
  });

  it("un valor con otro marcador no se reemplaza de nuevo", () => {
    const out = fillLegalPlaceholders("[RESPONSABLE] [DOMICILIO]", {
      LEGAL_RESPONSABLE: "[DOMICILIO]",
    });
    expect(out).toBe("\\[DOMICILIO\\] (dato en revisión)");
  });

  it("quita los caracteres de formato invisibles del valor", () => {
    const out = fillLegalPlaceholders("[RESPONSABLE]", {
      LEGAL_RESPONSABLE: "Res​pon‮sable",
    });
    expect(out).toBe("Responsable");
  });

  it("un valor con HTML o Markdown se muestra como texto, sin interpretarse", () => {
    const hostil = "<script>alert(1)</script> **x** [link](javascript:alert(1)) `c`";
    const out = fillLegalPlaceholders("Contacto: [EMAIL DE CONTACTO]", { LEGAL_EMAIL: hostil });
    const doc = parseLegalMarkdown(out);
    const block = doc.blocks[0]!;
    expect(block.type).toBe("paragraph");
    const nodes = (block as { children: InlineNode[] }).children;
    expect(nodes.every((n) => n.type === "text")).toBe(true);
    const texto = nodes.map((n) => (n as { text: string }).text).join("");
    expect(texto).toBe(`Contacto: ${hostil}`);
  });

  it("un valor con saltos de línea no rompe el bloque", () => {
    const out = fillLegalPlaceholders("[DOMICILIO]", { LEGAL_DOMICILIO: "a\n\n# b" });
    expect(out).not.toContain("\n");
  });
});

describe("legalTextIsDraft", () => {
  const LIMPIO =
    "Responsable: [RESPONSABLE], [DOMICILIO], [EMAIL DE CONTACTO]. " +
    "Se conservan por [A DEFINIR: plazo de retención de los logs].";

  it("con las cuatro variables válidas y sin marcas no es borrador", () => {
    expect(legalTextIsDraft(LIMPIO, COMPLETO)).toBe(false);
  });
  it("falta una variable que el texto usa: borrador", () => {
    expect(legalTextIsDraft(LIMPIO, { ...COMPLETO, LEGAL_EMAIL: " " })).toBe(true);
  });
  it("LEGAL_LOG_DAYS inválido: borrador", () => {
    expect(legalTextIsDraft(LIMPIO, { ...COMPLETO, LEGAL_LOG_DAYS: "abc" })).toBe(true);
  });
  it("una variable que el texto no usa no hace falta", () => {
    expect(
      legalTextIsDraft("Contacto: [EMAIL DE CONTACTO]", { LEGAL_EMAIL: "a@example.com" }),
    ).toBe(false);
  });
  it.each([
    "{{MAURO: edad}}",
    "[A REVISAR: x]",
    "[A CONFIRMAR: x]",
    "[CONFIRMAR x]",
    "[CONSULTAR: x]",
    "[A DEFINIR: jurisdicción]",
    "[A DEFINIR con Ani]",
  ])("%s deja el texto como borrador aunque estén todas las variables", (marca) => {
    expect(legalTextIsDraft(`${LIMPIO} ${marca}`, COMPLETO)).toBe(true);
  });
});

describe("legalMissing (C8-12, pnpm legal:check)", () => {
  const MD = [
    "# Título",
    "Responsable: **[RESPONSABLE]**, domicilio **[DOMICILIO]**.",
    "Contacto: [EMAIL DE CONTACTO].",
    "Se conservan por [A DEFINIR: plazo de retención de los logs].",
    "Precio: [A DEFINIR con Ani].",
  ].join("\n");

  it("sin variables lista cada marcador con su línea y la variable que lo completa", () => {
    expect(legalMissing(MD, {})).toEqual([
      { marker: "[RESPONSABLE]", line: 2, envKey: "LEGAL_RESPONSABLE" },
      { marker: "[DOMICILIO]", line: 2, envKey: "LEGAL_DOMICILIO" },
      { marker: "[EMAIL DE CONTACTO]", line: 3, envKey: "LEGAL_EMAIL" },
      { marker: "[A DEFINIR: plazo de retención de los logs]", line: 4, envKey: "LEGAL_LOG_DAYS" },
      { marker: "[A DEFINIR", line: 5, envKey: null },
    ]);
  });

  it("con las variables solo queda lo que hay que reescribir en el texto", () => {
    expect(legalMissing(MD, COMPLETO)).toEqual([{ marker: "[A DEFINIR", line: 5, envKey: null }]);
  });

  it("una variable inválida (días fuera de rango o texto vacío) cuenta como faltante", () => {
    const missing = legalMissing(MD, { ...COMPLETO, LEGAL_LOG_DAYS: "0", LEGAL_EMAIL: "   " });
    expect(missing.map((m) => m.envKey)).toEqual(["LEGAL_EMAIL", "LEGAL_LOG_DAYS", null]);
  });

  it("coincide con legalTextIsDraft: sin faltantes, el texto es vigente", () => {
    const clean = "Responsable: [RESPONSABLE].";
    expect(legalMissing(clean, COMPLETO)).toEqual([]);
    expect(legalTextIsDraft(clean, COMPLETO)).toBe(false);
    expect(legalTextIsDraft(MD, COMPLETO)).toBe(true);
  });
});
