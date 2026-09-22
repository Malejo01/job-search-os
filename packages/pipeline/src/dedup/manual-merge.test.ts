import { describe, expect, it } from "vitest";
import { planDuplicateMerge, type DuplicateCandidate } from "./manual-merge";

/**
 * JS-025 · Fusión manual de un `posible_duplicado` (ADR-013). La persona confirma que dos jobs son
 * el mismo aviso; la regla decide cuál queda y qué se lleva del otro, con las mismas reglas que la
 * fusión automática (fecha más antigua, texto más largo, flags acumulados).
 */
const original = (over: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({
  id: "orig",
  duplicateOfId: null,
  status: "evaluada",
  jdLength: 1800,
  firstSeenAt: new Date("2026-09-10T00:00:00Z"),
  flags: ["location_risk"],
  canonicalUrl: "https://empresa.example/jobs/1",
  hasHistory: true,
  ...over,
});

const marcado = (over: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({
  id: "dup",
  duplicateOfId: "orig",
  status: "pendiente_jd",
  jdLength: 0,
  firstSeenAt: new Date("2026-09-20T00:00:00Z"),
  flags: ["posible_duplicado", "title_cap:7"],
  canonicalUrl: "https://linkedin.com/jobs/view/123",
  hasHistory: false,
  ...over,
});

describe("planDuplicateMerge", () => {
  it("caso real: alerta sin JD marcada contra una evaluada → queda la evaluada y se lleva la fuente", () => {
    const plan = planDuplicateMerge(marcado(), original());
    expect(plan).toEqual({
      ok: true,
      value: {
        survivorId: "orig",
        absorbedId: "dup",
        takeJdFromAbsorbed: false,
        firstSeenAt: new Date("2026-09-10T00:00:00Z"),
        flags: ["location_risk", "title_cap:7"],
        canonicalUrl: "https://empresa.example/jobs/1",
        enqueueEvaluation: false,
      },
    });
  });

  it("la marca posible_duplicado no pasa al que queda", () => {
    const plan = planDuplicateMerge(marcado(), original({ flags: ["posible_duplicado"] }));
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.value.flags).not.toContain("posible_duplicado");
  });

  it("sin historia en ninguno queda el original (el más viejo)", () => {
    const plan = planDuplicateMerge(marcado(), original({ hasHistory: false }));
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.value).toMatchObject({ survivorId: "orig", absorbedId: "dup" });
  });

  it("si solo el marcado tiene historia, queda el marcado (no se pierde su evaluación)", () => {
    const plan = planDuplicateMerge(
      marcado({ hasHistory: true, status: "evaluada", jdLength: 900 }),
      original({ hasHistory: false, status: "pendiente_jd", jdLength: 0 }),
    );
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.value).toMatchObject({
      survivorId: "dup",
      absorbedId: "orig",
      takeJdFromAbsorbed: false,
      // la fecha más antigua es la del original, aunque quede el marcado
      firstSeenAt: new Date("2026-09-10T00:00:00Z"),
      canonicalUrl: "https://linkedin.com/jobs/view/123",
    });
  });

  it("los dos con historia: no se fusiona, se perdería una evaluación o una postulación", () => {
    expect(planDuplicateMerge(marcado({ hasHistory: true }), original())).toEqual({
      ok: false,
      error: "both_have_history",
    });
  });

  it("el JD más largo queda, venga de donde venga", () => {
    const plan = planDuplicateMerge(
      marcado({ jdLength: 2500 }),
      original({ jdLength: 1800, hasHistory: false }),
    );
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.value.takeJdFromAbsorbed).toBe(true);
  });

  it("si el que queda estaba esperando JD y recibe una, se encola la evaluación", () => {
    const plan = planDuplicateMerge(
      marcado({ jdLength: 0, status: "pendiente_jd" }),
      original({ jdLength: 0, status: "pendiente_jd", hasHistory: false }),
    );
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.value.enqueueEvaluation).toBe(false);

    const conJd = planDuplicateMerge(
      marcado({ jdLength: 2000, status: "prefiltrada" }),
      original({ jdLength: 0, status: "pendiente_jd", hasHistory: false }),
    );
    if (!conJd.ok) throw new Error(conJd.error);
    expect(conJd.value).toMatchObject({ takeJdFromAbsorbed: true, enqueueEvaluation: true });
  });

  it("si el que queda no tiene URL, hereda la del otro", () => {
    const plan = planDuplicateMerge(marcado(), original({ canonicalUrl: null }));
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.value.canonicalUrl).toBe("https://linkedin.com/jobs/view/123");
  });

  it("rechaza si el primero no está marcado como duplicado del segundo", () => {
    expect(planDuplicateMerge(marcado({ duplicateOfId: "otro" }), original())).toEqual({
      ok: false,
      error: "not_a_duplicate_pair",
    });
    expect(planDuplicateMerge(marcado({ duplicateOfId: null }), original())).toEqual({
      ok: false,
      error: "not_a_duplicate_pair",
    });
    expect(planDuplicateMerge(marcado({ id: "orig" }), original())).toEqual({
      ok: false,
      error: "not_a_duplicate_pair",
    });
  });

  it("rechaza un puntero sin la marca (el golden usa duplicate_of_id para volume_recruiting)", () => {
    expect(planDuplicateMerge(marcado({ flags: ["volume_recruiting"] }), original())).toEqual({
      ok: false,
      error: "not_a_duplicate_pair",
    });
  });
});
