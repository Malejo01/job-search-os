import { describe, expect, it } from "vitest";
import {
  POOL_COVERAGE_LOW_ACTIVE_30D,
  buildPoolCoverage,
  parsePoolCoverageCounts,
  type PoolCoverageCount,
} from "./coverage";

const row = (over: Partial<PoolCoverageCount>): PoolCoverageCount => ({
  role: "abogacia",
  source: "remoteok",
  active7: 2,
  active30: 5,
  spanish7: 1,
  spanish30: 3,
  ...over,
});

describe("buildPoolCoverage", () => {
  it("una fila por carrera, en el orden pedido, también las que no tienen ofertas", () => {
    const rows = buildPoolCoverage(["comunicacion", "abogacia"], [row({})]);
    expect(rows.map((r) => r.role)).toEqual(["comunicacion", "abogacia"]);
    expect(rows[0]).toMatchObject({ active7: 0, active30: 0, sources: [], low: true });
  });

  it("suma las fuentes de una carrera y ordena las fuentes de más a menos en 30 días", () => {
    const [r] = buildPoolCoverage(
      ["abogacia"],
      [
        row({ source: "wwr", active7: 1, active30: 2, spanish7: 0, spanish30: 1 }),
        row({ source: "remoteok", active7: 4, active30: 9, spanish7: 2, spanish30: 5 }),
        row({ source: "jobicy", active7: 0, active30: 2, spanish7: 0, spanish30: 0 }),
      ],
    );
    expect(r).toMatchObject({ active7: 5, active30: 13, spanish7: 2, spanish30: 6 });
    // empate en 2: por nombre
    expect(r!.sources.map((s) => s.source)).toEqual(["remoteok", "jobicy", "wwr"]);
  });

  it("junta las filas repetidas de la misma carrera y fuente", () => {
    const [r] = buildPoolCoverage(["abogacia"], [row({}), row({})]);
    expect(r!.sources).toEqual([{ source: "remoteok", active7: 4, active30: 10 }]);
  });

  it("ignora las carreras que no se pidieron y no mezcla una con otra", () => {
    const rows = buildPoolCoverage(
      ["abogacia", "comunicacion"],
      [row({ role: "qa", active30: 99 }), row({ role: "comunicacion", active30: 12, active7: 3 })],
    );
    expect(rows.map((r) => r.active30)).toEqual([0, 12]);
  });

  it("marca poco pool con menos de 10 ofertas activas en 30 días, no desde 10", () => {
    expect(POOL_COVERAGE_LOW_ACTIVE_30D).toBe(10);
    const low = buildPoolCoverage(["abogacia"], [row({ active30: 9 })])[0]!;
    const ok = buildPoolCoverage(["abogacia"], [row({ active30: 10 })])[0]!;
    expect([low.low, ok.low]).toEqual([true, false]);
  });
});

describe("parsePoolCoverageCounts: falla cerrado", () => {
  it("acepta filas bien formadas", () => {
    expect(parsePoolCoverageCounts([row({})])).toEqual([row({})]);
    expect(parsePoolCoverageCounts([])).toEqual([]);
  });

  it.each([
    ["no es una lista", { role: "abogacia" }],
    ["un campo de más", [{ ...row({}), title: "Aviso" }]],
    ["un número negativo", [row({ active30: -1 })]],
    ["un número no entero", [row({ active30: 1.5 })]],
    ["un texto donde va un número", [{ ...row({}), active7: "2" }]],
    ["7 días mayor que 30", [row({ active7: 6, active30: 5 })]],
    ["español mayor que el total", [row({ spanish30: 9 })]],
    ["falta la fuente", [{ ...row({}), source: undefined }]],
  ])("descarta todo si %s", (_name, raw) => {
    expect(parsePoolCoverageCounts(raw)).toBeNull();
  });
});
