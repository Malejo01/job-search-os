import type { CvIssue } from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import { loadCvCoachGolden } from "./golden";
import { issueScriptKey, personaAnswer, personaText } from "./persona";

const f = loadCvCoachGolden({ ids: ["con-experiencia"] })[0]!.fixture;
const exp1 = f.lectura.items.find((i) => i.clave === "exp-1")!.id;

const issue = (over: Partial<CvIssue>): CvIssue => ({
  id: "iss:1",
  type: "logro_sin_resultado",
  ref: { section: "experience", itemId: exp1, field: null },
  quote: null,
  skillSlug: null,
  severity: "media",
  source: "model",
  ...over,
});

describe("persona guionada (código, no un modelo)", () => {
  it("responde lo guionado para el tipo y el ítem, y a la repregunta lo siguiente de la lista", () => {
    expect(issueScriptKey(issue({}), f)).toBe("exp-1");
    expect(personaText(f, issue({}), 0)).toMatch(/de 8 a 5 días/);
    expect(personaAnswer(f, issue({}), 1)).toEqual({ kind: "none", issueId: "iss:1" });
  });

  it("para una skill usa el slug; el comodín `*` vale para el resto", () => {
    const erp = issue({
      type: "brecha_con_puesto",
      skillSlug: "erp_accounting",
      ref: { section: "skills", itemId: "erp_accounting", field: null },
    });
    expect(personaText(f, erp, 0)).toMatch(/Tango/);
    const other = issue({
      type: "brecha_con_puesto",
      skillSlug: "financial_reporting",
      ref: { section: "skills", itemId: "financial_reporting", field: null },
    });
    expect(personaAnswer(f, other, 0)).toEqual({ kind: "none", issueId: "iss:1" });
  });

  it("lo no guionado es «no tengo» (el botón): no se inventa una respuesta", () => {
    expect(personaAnswer(f, issue({ type: "inconsistencia" }), 0)).toEqual({
      kind: "none",
      issueId: "iss:1",
    });
  });

  it("es repetible: la misma pregunta da la misma respuesta", () => {
    expect(personaAnswer(f, issue({}), 0)).toEqual(personaAnswer(f, issue({}), 0));
  });
});
