import { describe, expect, it } from "vitest";
import { affinityRows } from "../app/(app)/jobs/[id]/affinity-view";

describe("affinityRows", () => {
  it("escribe el puntaje con coma y la palabra de textos-rediseno", () => {
    const [row] = affinityRows([{ key: "role_skills", score: 7.5, level: "high" }]);
    expect(row).toMatchObject({
      label: "Rol y habilidades",
      scoreText: "7,5",
      word: "Te calza",
      percent: 75,
    });
  });

  it("un puntaje entero no lleva decimales", () => {
    const [row] = affinityRows([{ key: "language", score: 10, level: "high" }]);
    expect(row?.scoreText).toBe("10");
  });

  it("sin datos dice «Sin datos» y no trae puntaje", () => {
    const [row] = affinityRows([{ key: "seniority", score: null, level: null }]);
    expect(row).toMatchObject({ scoreText: null, word: "Sin datos", percent: 0 });
  });
});
