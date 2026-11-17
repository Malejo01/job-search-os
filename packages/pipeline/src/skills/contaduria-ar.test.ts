import { describe, expect, it } from "vitest";
import taxonomy from "../../../db/seeds/skills.json";
import { compileTaxonomy, extractSkillsFromText } from "./match";

/** R11-13: catálogo de Contaduría para Argentina. Avisos inventados. */
const extract = (text: string) => extractSkillsFromText(text, compileTaxonomy(taxonomy));

describe("software contable y ARCA/AFIP", () => {
  it.each([
    ["Manejo de Tango Gestión", "erp_accounting"],
    ["Experiencia en Bejerman", "erp_accounting"],
    ["Conocimientos de SAP FI/CO", "erp_accounting"],
    ["SAP FICO deseable", "erp_accounting"],
    ["Liquidación de impuestos ante ARCA", "tax_compliance"],
    ["Presentaciones en AFIP y Libro IVA Digital", "tax_compliance"],
    ["Monotributo e Ingresos Brutos", "tax_compliance"],
  ])("«%s» → %s", (text, slug) => {
    expect(extract(text)).toContain(slug);
  });

  it("no se pierde lo que ya había: NetSuite y QuickBooks siguen siendo software contable", () => {
    expect(extract("NetSuite y QuickBooks")).toContain("erp_accounting");
  });
});

describe("la taxonomía conserva sus slugs y nombra distinto lo que no es solo de tecnología", () => {
  const bySlug = new Map(taxonomy.map((s) => [s.slug, s]));

  it("los slugs que ya estaban guardados siguen", () => {
    for (const slug of ["client_facing", "erp_accounting", "tax_compliance"]) {
      expect(bySlug.has(slug), slug).toBe(true);
    }
  });

  it("«Client-facing» ya no es la etiqueta visible de la skill", () => {
    expect(bySlug.get("client_facing")!.name).not.toMatch(/client-facing/i);
    expect(bySlug.get("client_facing")!.description).not.toMatch(/client-facing/i);
    // y quien escriba «client-facing» en un aviso sigue matcheando
    expect(extract("Perfil client-facing")).toContain("client_facing");
  });

  it("el nombre del software contable nombra el de Argentina", () => {
    expect(bySlug.get("erp_accounting")!.name).toMatch(/Tango/);
    expect(bySlug.get("erp_accounting")!.name).toMatch(/Bejerman/);
    expect(bySlug.get("tax_compliance")!.name).toMatch(/ARCA\/AFIP/);
  });
});
