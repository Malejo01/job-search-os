import { describe, expect, it } from "vitest";
import { transparencyView } from "../app/(app)/jobs/[id]/transparency-view";

describe("transparencyView", () => {
  it("escribe el puntaje con coma, la palabra de textos-rediseno y los faltantes en llano", () => {
    const v = transparencyView({ score: 8.5, level: "clear", missing: ["salary"] });
    expect(v).toEqual({ scoreText: "8,5", word: "Aviso claro", missing: ["El sueldo"] });
  });

  it("un aviso opaco con todo faltante", () => {
    const v = transparencyView({
      score: 0,
      level: "opaque",
      missing: ["modality", "tasks"],
    });
    expect(v.scoreText).toBe("0");
    expect(v.word).toBe("Aviso opaco");
    expect(v.missing).toEqual(["La modalidad de trabajo", "Las tareas concretas del puesto"]);
  });
});
