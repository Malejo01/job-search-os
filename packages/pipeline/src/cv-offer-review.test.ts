import { describe, expect, it } from "vitest";
import { reviewCvForOffer, type OfferRequirementInput } from "./cv-offer-review";
import type { CvHistoryInput } from "./cv-out/model";

const job = (bullets: string[]): CvHistoryInput => ({
  kind: "trabajo",
  organization: "Empresa A",
  title: "Desarrolladora",
  startMonth: "2022-01",
  endMonth: null,
  bullets,
});

const offerSkills = [
  { name: "TypeScript", isMust: true },
  { name: "PostgreSQL", aliases: ["postgres"], isMust: true },
  { name: "Docker", isMust: false },
  { name: "Go", isMust: true },
];

describe("reviewCvForOffer", () => {
  it("separa lo que ya se ve en una experiencia, lo que solo figura en skills y lo que no tiene respaldo", () => {
    const r = reviewCvForOffer({
      offerSkills,
      cvSkills: ["Docker", "TypeScript"],
      history: [job(["Armé una API en TypeScript con tests"])],
      requirements: [],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.covered.map((c) => c.name)).toEqual(["TypeScript", "Docker"]);
    expect(r.value.covered[0]?.evidence?.organization).toBe("Empresa A");
    expect(r.value.covered[1]?.evidence).toBeNull();
    expect(r.value.unbacked).toEqual([
      { name: "PostgreSQL", isMust: true },
      { name: "Go", isMust: true },
    ]);
    // Docker figura en la lista de skills pero ninguna experiencia lo muestra: conviene aclararlo
    expect(r.value.toClarify).toEqual([
      { kind: "skill_sin_experiencia", name: "Docker", isMust: false },
    ]);
  });

  it("suma como «conviene aclarar» los requisitos de la tabla sin confirmar que el CV puede mostrar", () => {
    const requirements: OfferRequirementInput[] = [
      { code: "ingles", nivel: "must", state: "sinConfirmar", pide: "Inglés conversacional" },
      { code: "pais", nivel: "must", state: "sinConfirmar", pide: "Residir en el país B" },
      { code: "skill", nivel: "must", state: "sinConfirmar", pide: "Go" },
      { code: "req", nivel: "deseable", state: "coincide", pide: "Trabajo en equipos" },
      { code: "anos", nivel: "must", state: "noCoincide", pide: "3 años" },
    ];
    const r = reviewCvForOffer({
      offerSkills,
      cvSkills: [],
      history: [job(["Armé una API en TypeScript"])],
      requirements,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const asked = r.value.toClarify.filter((c) => c.kind === "requisito");
    // Solo el inglés: país no es algo del CV, la skill ya está arriba, lo que coincide no se aclara
    // y un «no coincide» no se resuelve reescribiendo el CV
    expect(asked).toEqual([
      { kind: "requisito", code: "ingles", nivel: "must", pide: "Inglés conversacional" },
    ]);
  });

  it("falla cerrado sin requisitos o sin CV", () => {
    const sin = reviewCvForOffer({
      offerSkills: [],
      cvSkills: ["Go"],
      history: [],
      requirements: [],
    });
    expect(sin).toEqual({ ok: false, error: "sin_requisitos" });
    const sinCv = reviewCvForOffer({ offerSkills, cvSkills: [], history: [], requirements: [] });
    expect(sinCv).toEqual({ ok: false, error: "sin_cv" });
  });

  it("no inventa: un requisito sin respaldo no pasa a «cubierto» por estar en la tabla", () => {
    const r = reviewCvForOffer({
      offerSkills,
      cvSkills: ["Docker"],
      history: [job(["Mantuve servicios con Docker"])],
      requirements: [{ code: "skill", nivel: "must", state: "coincide", pide: "Go" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.covered.map((c) => c.name)).toEqual(["Docker"]);
    expect(r.value.unbacked.map((u) => u.name)).toContain("Go");
  });
});
