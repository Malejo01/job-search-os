import { describe, expect, it } from "vitest";
import { createDemoLlm, demoDrafts } from "../llm/demo";
import { classifyFixed, DraftApplicationAnswersSchema } from "./drafts";

describe("classifyFixed", () => {
  it.each([
    ["What are your salary expectations?", "salary"],
    ["¿Cuál es tu pretensión salarial?", "salary"],
    ["Are you legally authorized to work in this country?", "work_authorization"],
    ["Do you require visa sponsorship?", "work_authorization"],
    ["When can you start?", "availability"],
    ["¿Cuál es tu disponibilidad para incorporarte?", "availability"],
    ["Link to your GitHub profile", "links"],
    ["Are you open to a contractor (B2B) agreement?", "contract"],
    ["Salary expectations for a contract role", "salary"],
  ])("%s → %s", (text, kind) => {
    expect(classifyFixed(text)).toBe(kind);
  });

  it("el texto libre va al modelo", () => {
    expect(classifyFixed("Describe a project where you built an agent")).toBeNull();
    expect(classifyFixed("¿Por qué te interesa este puesto?")).toBeNull();
  });

  it("'rate' y 'contract' sueltos no disparan respuestas fijas (revisor, ronda 04)", () => {
    expect(classifyFixed("How would you rate your React skills?")).toBeNull();
    expect(classifyFixed("Tell us about your last contract role")).toBeNull();
    expect(classifyFixed("What is your expected hourly rate?")).toBe("salary");
    expect(classifyFixed("Would you work on a contract or full-time basis?")).toBe("contract");
  });
});

describe("LLM falso para draft_application_answers", () => {
  const facts = JSON.stringify([{ key: "proyecto-demo", claim: "Construyó un agente de ejemplo" }]);
  const questions = JSON.stringify([{ id: "q1", text: "Describe a project" }]);

  it("cumple el esquema y cita una clave que existe", async () => {
    const r = await createDemoLlm().generateStructured(
      "draft_application_answers",
      DraftApplicationAnswersSchema,
      { facts, questions },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.model).toBe("fake");
      expect(r.value.object.drafts).toEqual([
        expect.objectContaining({ question_id: "q1", sources: ["proyecto-demo"] }),
      ]);
    }
  });

  it("sin hechos devuelve 'sin fuente', no una respuesta", () => {
    const out = demoDrafts({ facts: JSON.stringify({ marca: "sin_hechos_cargados" }), questions });
    expect(out).toEqual({
      drafts: [
        { question_id: "q1", draft: "", sources: [], confidence: "baja", note: "sin fuente" },
      ],
    });
  });
});
