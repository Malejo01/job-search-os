import { compileTaxonomy, extractSkillsFromText, normalizeMention } from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import skills from "../seeds/skills.json";

/**
 * Skills de la ronda C-2b (finanzas, contabilidad, asistencia y operaciones). Todo inventado.
 * La suite general de taxonomía vive en packages/pipeline; acá van los casos de las 8 skills nuevas
 * y del recorte de hr_generalist, que dependen del seed de este paquete.
 */
type Entry = {
  slug: string;
  name: string;
  category: string;
  aliases: string[];
  closure_hours: number;
  description: string;
};
const taxonomy = skills as Entry[];
const compiled = compileTaxonomy(taxonomy);
const extract = (text: string) => extractSkillsFromText(text, compiled);

const C2B_SLUGS = [
  "general_accounting",
  "financial_reporting",
  "erp_accounting",
  "tax_compliance",
  "payroll",
  "calendar_inbox",
  "office_suite",
  "data_entry",
];

describe("skills de la ronda C-2b: el seed", () => {
  const find = (slug: string) => taxonomy.find((s) => s.slug === slug);

  it("están las 8, en categoría dominio, con descripción de hasta 140 caracteres", () => {
    for (const slug of C2B_SLUGS) {
      const s = find(slug);
      expect(s, slug).toBeDefined();
      expect(s!.category, slug).toBe("dominio");
      expect(s!.description.length, slug).toBeLessThanOrEqual(140);
      expect(s!.closure_hours, slug).toBeGreaterThan(0);
    }
  });

  it("ningún término se repite entre skills distintas ni dentro de una misma skill", () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    const termsOf = (s: Entry) =>
      new Set([s.slug.replace(/_/g, " "), s.name, ...s.aliases].map(normalizeMention));
    const isNew = (s: Entry) => C2B_SLUGS.includes(s.slug) || s.slug === "hr_generalist";
    for (const s of taxonomy.filter(isNew)) {
      // Las variantes con y sin tilde (nómina/nomina) son deliberadas: solo se controla entre skills.
      expect(new Set(s.aliases).size, `${s.slug}: alias repetido`).toBe(s.aliases.length);
      for (const t of termsOf(s)) {
        const prev = owner.get(t);
        if (prev && prev !== s.slug) clashes.push(`"${t}": ${prev} / ${s.slug}`);
        owner.set(t, s.slug);
      }
    }
    // Contra el resto de la taxonomía
    for (const s of taxonomy.filter((x) => !isNew(x))) {
      for (const t of termsOf(s)) {
        const prev = owner.get(t);
        if (prev) clashes.push(`"${t}": ${prev} / ${s.slug}`);
      }
    }
    expect(clashes).toEqual([]);
  });

  it("hr_generalist ya no tiene payroll ni nómina entre sus alias", () => {
    const hr = find("hr_generalist")!;
    const norm = hr.aliases.map(normalizeMention);
    expect(norm).not.toContain("payroll");
    expect(norm).not.toContain("nomina");
  });
});

describe("skills de la ronda C-2b: detección", () => {
  it.each([
    ["general_accounting", "Month-end close and general ledger reconciliations."],
    ["financial_reporting", "Support FP&A with budgeting and variance analysis."],
    ["erp_accounting", "Experience with NetSuite or QuickBooks."],
    ["tax_compliance", "Prepare sales tax filings and support the internal audit."],
    ["payroll", "Run payroll processing for two countries."],
    ["payroll", "Liquidación de sueldos y nómina mensual."],
    ["calendar_inbox", "Calendar management and travel arrangements for the founder."],
    ["office_suite", "Daily work in Google Workspace and Microsoft 365."],
    ["data_entry", "Data entry of invoices into our system."],
  ])("detecta %s en: %s", (slug, text) => {
    expect(extract(text)).toContain(slug);
  });

  it("payroll ya no cuelga de hr_generalist", () => {
    const found = extract("Run payroll processing.");
    expect(found).toContain("payroll");
    expect(found).not.toContain("hr_generalist");
  });

  it.each([
    ["erp_accounting", "We integrate with SAP and other systems."],
    ["erp_accounting", "Knowledge of any ERP is welcome."],
    ["tax_compliance", "We audit our servers every quarter."],
    ["tax_compliance", "Pay the VAT of the month."],
    ["general_accounting", "Usage accounting for our cloud product."],
    ["general_accounting", "Strong accounting background."],
  ])("no marca %s en: %s", (slug, text) => {
    expect(extract(text)).not.toContain(slug);
  });
});
