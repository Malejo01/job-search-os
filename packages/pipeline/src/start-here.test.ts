import { describe, expect, it } from "vitest";
import { startHere, type StartHereFacts } from "./start-here";

const base: StartHereFacts = {
  summaryFilled: true,
  skillsLoaded: true,
  targetRoles: ["abogacia"],
  specialtiesSaved: false,
  hasJobs: false,
  cvEnabled: true,
  cvStarted: false,
};

describe("startHere («Empezá acá», C8-5)", () => {
  it("una persona recién llegada de abogacía: perfil hecho, el resto pendiente", () => {
    const r = startHere(base);
    expect(r.steps.map((s) => [s.id, s.done])).toEqual([
      ["perfil", true],
      ["areas", false],
      ["ofertas", false],
      ["cv", false],
    ]);
    expect(r).toMatchObject({ done: 1, total: 4, complete: false, next: "areas" });
  });

  it("cada paso se marca solo con datos que ya existen", () => {
    const r = startHere({ ...base, specialtiesSaved: true, hasJobs: true, cvStarted: true });
    expect(r.complete).toBe(true);
    expect(r.next).toBeNull();
  });

  it("perfil: sin resumen lleva a «Tu perfil»; sin lo que sabés, a las skills", () => {
    const noSummary = startHere({ ...base, summaryFilled: false }).steps[0]!;
    expect(noSummary).toMatchObject({ done: false, link: { href: "/settings/perfil" } });
    const noSkills = startHere({ ...base, skillsLoaded: false }).steps[0]!;
    expect(noSkills).toMatchObject({ done: false, link: { href: "/settings/skills" } });
  });

  it("áreas: solo si alguna carrera elegida tiene áreas; si no, el paso no aparece", () => {
    const r = startHere({ ...base, targetRoles: ["frontend"] });
    expect(r.steps.map((s) => s.id)).toEqual(["perfil", "ofertas", "cv"]);
    const areas = startHere(base).steps.find((s) => s.id === "areas")!;
    expect(areas.link).toEqual({ label: "Elegir mis áreas", href: "/settings#puesto" });
  });

  it("CV: sin el chat de CV habilitado, el paso no aparece", () => {
    const r = startHere({ ...base, cvEnabled: false });
    expect(r.steps.map((s) => s.id)).toEqual(["perfil", "areas", "ofertas"]);
    expect(r.total).toBe(3);
  });

  it("ofertas: pegar una o esperar las del pool, con link a pegar", () => {
    const step = startHere(base).steps.find((s) => s.id === "ofertas")!;
    expect(step.link?.href).toBe("/jobs/new");
    expect(step.help).toMatch(/todos los días/);
    const done = startHere({ ...base, hasJobs: true }).steps.find((s) => s.id === "ofertas")!;
    expect(done).toMatchObject({ done: true, link: null });
  });

  it("textos sin jerga: ni «skills», ni «pool», ni «score»", () => {
    for (const facts of [base, { ...base, skillsLoaded: false, summaryFilled: false }]) {
      for (const s of startHere(facts).steps) {
        const text = `${s.title} ${s.help ?? ""} ${s.link?.label ?? ""}`;
        expect(text).not.toMatch(/skill|pool|score|prompt/i);
      }
    }
  });
});
