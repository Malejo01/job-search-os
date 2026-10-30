import { describe, expect, it } from "vitest";
import type { Checklist, ChecklistItem } from "./checklist";
import { parseSingleSkillLevel, withCurrentSkillLevels } from "./skill-level-overlay";

const item = (over: Partial<ChecklistItem> & { id: string }): ChecklistItem => ({
  kind: "estructurado",
  nivel: "must",
  pide: over.id,
  evidencia: null,
  tenes: null,
  status: "cumple",
  fuente: { pide: "fuente", tenes: "perfil" },
  bloquea: false,
  ...over,
});

const skill = (slug: string, over: Partial<ChecklistItem> = {}): ChecklistItem =>
  item({
    id: `skill:${slug}`,
    kind: "skill",
    nivel: "deseable",
    pide: `Menciona ${slug}`,
    tenes: null,
    status: "no_se_sabe",
    fuente: { pide: "fuente", tenes: null },
    ...over,
  });

const anos = item({ id: "anos", pide: "3 años", tenes: "5 años" });
const ingles = item({ id: "ingles", pide: "Inglés avanzado", tenes: "B1", status: "no_cumple" });

const checklist = (items: ChecklistItem[]): Checklist => ({
  items,
  must: { cumple: 1, no_cumple: 1, no_se_sabe: 0 },
  deseable: { cumple: 0, no_cumple: 0, no_se_sabe: 0 },
  parcial: false,
  descarte_rapido: ingles,
});

describe("withCurrentSkillLevels", () => {
  it("una skill sin nivel guardado pasa a tener el nivel actual", () => {
    const out = withCurrentSkillLevels(
      checklist([anos, skill("docker")]),
      new Map([["docker", 2]]),
    );
    const docker = out.items.find((i) => i.id === "skill:docker")!;
    expect(docker).toMatchObject({
      status: "cumple",
      tenes: "Nivel 2 de 3",
      fuente: { pide: "fuente", tenes: "skills" },
    });
  });

  it("nivel 1 es «no cumple» y nivel 2 o 3 es «cumple»", () => {
    const base = checklist([skill("a"), skill("b"), skill("c"), skill("d")]);
    const out = withCurrentSkillLevels(
      base,
      new Map([
        ["a", 0],
        ["b", 1],
        ["c", 2],
        ["d", 3],
      ]),
    );
    expect(out.items.map((i) => i.status)).toEqual(["no_cumple", "no_cumple", "cumple", "cumple"]);
    expect(out.items[1]!.tenes).toBe("Nivel 1 de 3");
  });

  it("un nivel cambiado pisa el que guardó la evaluación", () => {
    const viejo = skill("docker", {
      status: "no_cumple",
      tenes: "Nivel 1 de 3",
      fuente: { pide: "fuente", tenes: "skills" },
    });
    const out = withCurrentSkillLevels(checklist([viejo]), new Map([["docker", 3]]));
    expect(out.items[0]).toMatchObject({ status: "cumple", tenes: "Nivel 3 de 3" });
  });

  it("las skills sin nivel actual y los ítems que no son skill quedan intactos", () => {
    const base = checklist([anos, ingles, skill("docker"), skill("redis")]);
    const out = withCurrentSkillLevels(base, new Map([["redis", 2]]));
    expect(out.items[0]).toBe(anos);
    expect(out.items[1]).toBe(ingles);
    expect(out.items[2]).toBe(base.items[2]);
    expect(out.items[3]!.status).toBe("cumple");
  });

  it("no cambia el titular «must», lo deseable ni la primera mirada: las skills no cuentan", () => {
    const base = checklist([anos, ingles, skill("docker")]);
    const out = withCurrentSkillLevels(base, new Map([["docker", 3]]));
    expect(out.must).toEqual(base.must);
    expect(out.deseable).toEqual(base.deseable);
    expect(out.descarte_rapido).toBe(base.descarte_rapido);
    expect(out.parcial).toBe(base.parcial);
  });

  it("no muta el checklist de entrada", () => {
    const base = checklist([skill("docker")]);
    const copy = structuredClone(base);
    withCurrentSkillLevels(base, new Map([["docker", 2]]));
    expect(base).toEqual(copy);
  });

  it("ignora niveles fuera de 0 a 3", () => {
    const base = checklist([skill("docker")]);
    const out = withCurrentSkillLevels(base, new Map([["docker", 7]]));
    expect(out.items[0]).toBe(base.items[0]);
  });
});

describe("parseSingleSkillLevel", () => {
  const taxonomy = ["docker", "english_fluent", "redis"];

  it("acepta un slug de la taxonomía y un nivel de 0 a 3", () => {
    expect(parseSingleSkillLevel({ slug: "docker", level: 2 }, taxonomy)).toEqual({
      ok: true,
      entry: { slug: "docker", level: 2 },
    });
    expect(parseSingleSkillLevel({ slug: "redis", level: 0 }, taxonomy).ok).toBe(true);
  });

  it("rechaza un slug fuera de la taxonomía, con el campo y sin el valor", () => {
    expect(parseSingleSkillLevel({ slug: "no_existe", level: 2 }, taxonomy)).toEqual({
      ok: false,
      field: "slug",
    });
    expect(parseSingleSkillLevel({ slug: "../x", level: 2 }, taxonomy)).toEqual({
      ok: false,
      field: "slug",
    });
    expect(parseSingleSkillLevel({ slug: 5, level: 2 }, taxonomy)).toEqual({
      ok: false,
      field: "slug",
    });
  });

  it("rechaza niveles fuera de rango o que no son enteros", () => {
    for (const level of [-1, 4, 1.5, Number.NaN, "2", null, undefined]) {
      expect(parseSingleSkillLevel({ slug: "docker", level }, taxonomy)).toEqual({
        ok: false,
        field: "level",
      });
    }
  });

  it("rechaza las skills de inglés: se cargan por nivel CEFR en Ajustes", () => {
    expect(parseSingleSkillLevel({ slug: "english_fluent", level: 3 }, taxonomy)).toEqual({
      ok: false,
      field: "slug",
    });
  });

  it("rechaza una entrada que no es un objeto", () => {
    expect(parseSingleSkillLevel(null, taxonomy).ok).toBe(false);
    expect(parseSingleSkillLevel("docker", taxonomy).ok).toBe(false);
  });
});
