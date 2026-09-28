import { describe, expect, it } from "vitest";
import { parseApplicantFile, planFactsSync, type FactInput, type FactRow } from "./applicant-file";

const fact = (p: Partial<FactInput> = {}): FactInput => ({
  key: "costo",
  project: "Proyecto X",
  claim: "Bajé el costo por evaluación",
  metric: "−40 %",
  source: "https://example.test/costos",
  verification: "verificable",
  sort: 0,
  ...p,
});
const row = (p: Partial<FactRow> = {}): FactRow => ({ ...fact(), active: true, ...p });

describe("parseApplicantFile (JS-053)", () => {
  const valid = {
    _nota: "ejemplo",
    settings: {
      availability: "Inmediata",
      contract: "Contractor",
      work_authorization: "Sin sponsorship",
      links: { github: "https://github.com/ejemplo" },
    },
    facts: [
      { key: "a", project: "P", claim: "C", source: "S" },
      {
        key: "b",
        project: "P",
        claim: "C",
        source: "S",
        verification: "autodeclarado",
        metric: "80+",
      },
    ],
  };

  it("acepta el formato y completa los valores por defecto", () => {
    const r = parseApplicantFile(valid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.facts[0]).toEqual({
      key: "a",
      project: "P",
      claim: "C",
      metric: null,
      source: "S",
      verification: "verificable",
      sort: 0,
    });
    expect(r.value.facts[1]).toMatchObject({ verification: "autodeclarado", sort: 1 });
    expect(r.value.settings.links).toEqual({ github: "https://github.com/ejemplo" });
  });

  it("source es obligatorio y no puede quedar en blanco", () => {
    const r = parseApplicantFile({
      ...valid,
      facts: [{ key: "a", project: "P", claim: "C", source: "  " }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.join(" ")).toMatch(/facts\.0\.source/);
    expect(
      parseApplicantFile({ ...valid, facts: [{ key: "a", project: "P", claim: "C" }] }).ok,
    ).toBe(false);
  });

  it("verification solo verificable | autodeclarado", () => {
    const r = parseApplicantFile({
      ...valid,
      facts: [{ key: "a", project: "P", claim: "C", source: "S", verification: "seguro" }],
    });
    expect(r.ok).toBe(false);
  });

  it("claves repetidas → error que las nombra", () => {
    const r = parseApplicantFile({
      ...valid,
      facts: [
        { key: "a", project: "P", claim: "C", source: "S" },
        { key: "a", project: "P", claim: "D", source: "S" },
      ],
    });
    expect(r).toEqual({ ok: false, error: ["clave repetida en facts: a"] });
  });

  it("links tienen que ser URLs", () => {
    expect(parseApplicantFile({ ...valid, settings: { links: { github: "no es url" } } }).ok).toBe(
      false,
    );
  });
});

describe("planFactsSync", () => {
  it("inserta lo nuevo, actualiza lo cambiado y deja igual lo idéntico", () => {
    const plan = planFactsSync(
      [row({ key: "igual" }), row({ key: "cambia", claim: "viejo" })],
      [fact({ key: "igual" }), fact({ key: "cambia", claim: "nuevo" }), fact({ key: "nuevo" })],
    );
    expect(plan.insert.map((f) => f.key)).toEqual(["nuevo"]);
    expect(plan.update).toEqual([
      { key: "cambia", fact: fact({ key: "cambia", claim: "nuevo" }), fields: ["claim"] },
    ]);
    expect(plan.deactivate).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it("lo que ya no está en el archivo se desactiva, no se borra", () => {
    const plan = planFactsSync(
      [row({ key: "sale" }), row({ key: "queda" })],
      [fact({ key: "queda" })],
    );
    expect(plan.deactivate).toEqual(["sale"]);
  });

  it("lo ya inactivo que sigue fuera del archivo no se vuelve a desactivar", () => {
    const plan = planFactsSync([row({ key: "viejo", active: false })], []);
    expect(plan.deactivate).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it("un hecho inactivo que vuelve al archivo se reactiva", () => {
    const plan = planFactsSync([row({ key: "vuelve", active: false })], [fact({ key: "vuelve" })]);
    expect(plan.update).toEqual([
      { key: "vuelve", fact: fact({ key: "vuelve" }), fields: ["active"] },
    ]);
  });

  it("detecta cambio de verificación y de métrica a null", () => {
    const plan = planFactsSync(
      [row({ key: "k", metric: "80+", verification: "verificable" })],
      [fact({ key: "k", metric: null, verification: "autodeclarado" })],
    );
    expect(plan.update[0]!.fields).toEqual(["metric", "verification"]);
  });
});
