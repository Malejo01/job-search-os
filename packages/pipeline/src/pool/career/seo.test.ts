import { describe, expect, it } from "vitest";
import { buildCareerMarket } from "./career-market";
import { careerDatasetJsonLd, careerSeoDescription, jsonLdString } from "./seo";
import type { CareerMarket, CareerSkillRow } from "./types";

const NOW = "2026-10-23T12:00:00Z";
const EMPTY = buildCareerMarket({
  role: "data_analyst",
  jobs: [],
  skills: [],
  poolUpdatedAt: null,
  now: NOW,
});

function skill(slug: string, name: string): CareerSkillRow {
  const row = { slug, name, jobs: 10, must: 5, nice: 5, share: 0.5 };
  return row as CareerSkillRow;
}

const SKILLS = [skill("sql", "SQL"), skill("excel", "Excel"), skill("power_bi", "Power BI")];
const FULL: CareerMarket = { ...EMPTY, total: 40, smallSample: false, skills: SKILLS };

// Separadores de línea y de párrafo de Unicode, armados por código para no tenerlos literales
const SEPARATORS = String.fromCharCode(0x2028) + String.fromCharCode(0x2029);

describe("SEO de la vitrina por carrera (C-18)", () => {
  it("con datos, la descripción dice cuántas ofertas y lo más pedido", () => {
    expect(careerSeoDescription(FULL, "Data Analyst")).toBe(
      "40 ofertas públicas de Data Analyst en los últimos 30 días. Lo más pedido: SQL, Excel y Power BI.",
    );
  });

  it("con pocas ofertas, la descripción es genérica y no nombra skills", () => {
    const few = { ...FULL, total: 4 };
    expect(careerSeoDescription(few, "Data Analyst")).not.toMatch(/SQL|\d/);
    expect(careerSeoDescription(EMPTY, "Data Analyst")).toMatch(/^Qué piden las ofertas/);
  });

  it("es un Dataset, nunca un JobPosting, con la fecha del pool", () => {
    const url = "https://x.test/m";
    const ld = careerDatasetJsonLd({ market: FULL, label: "Data Analyst", url });
    expect(ld["@type"]).toBe("Dataset");
    expect(JSON.stringify(ld)).not.toContain("JobPosting");
    expect(ld.dateModified).toBe(NOW);
    expect(ld.keywords).toEqual(["Data Analyst", "SQL", "Excel", "Power BI"]);
  });

  it("el JSON-LD no puede cerrar el script: sin «<», «>», «&» ni separadores literales", () => {
    const evil = { name: `</script><script>alert(1)</script> & ${SEPARATORS}` };
    const out = jsonLdString(evil);
    for (const c of ["<", ">", "&", ...SEPARATORS]) expect(out).not.toContain(c);
    expect(JSON.parse(out)).toEqual(evil);
  });
});
