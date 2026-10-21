import { describe, expect, it } from "vitest";
import { portalStatsRows, sourceGroupOf, type PortalStatsInput } from "./portal-stats";

describe("sourceGroupOf", () => {
  it("agrupa los mails y las APIs por portal", () => {
    expect(sourceGroupOf("email_linkedin", "alerta")).toBe("LinkedIn");
    expect(sourceGroupOf("email_generic", "Indeed (email)")).toBe("Indeed");
    expect(sourceGroupOf("email_generic", "Otro portal")).toBe("Email");
    expect(sourceGroupOf("email_generic", null)).toBe("Email");
    expect(sourceGroupOf("email_getonboard", null)).toBe("Get on Board");
    expect(sourceGroupOf("getonboard_api", "GoB programming")).toBe("Get on Board");
  });

  it("usa el rótulo del pool y «Cargadas por vos» para lo manual", () => {
    expect(sourceGroupOf("remoteok", null)).toBe("Remote OK");
    expect(sourceGroupOf("wwr", null)).toBe("We Work Remotely");
    expect(sourceGroupOf("manual", null)).toBe("Cargadas por vos");
    expect(sourceGroupOf("otra_cosa", null)).toBe("Otra");
  });
});

const row = (group: string, over: Partial<PortalStatsInput> = {}): PortalStatsInput => ({
  group,
  score: null,
  applied: false,
  interview: false,
  ...over,
});

describe("portalStatsRows", () => {
  it("cuenta por grupo y ordena por total", () => {
    const rows = [
      ...Array.from({ length: 2 }, () => row("B")),
      ...Array.from({ length: 6 }, (_, i) =>
        row("A", { score: i < 2 ? 8 : i === 2 ? 6.9 : null, applied: i === 0, interview: i === 3 }),
      ),
    ];
    const out = portalStatsRows(rows, { minForStats: 5 });
    expect(out.map((r) => r.group)).toEqual(["A", "B"]);
    expect(out[0]).toEqual({
      group: "A",
      total: 6,
      highScore: 2,
      applied: 1,
      interview: 1,
      fewData: false,
    });
    expect(out[1]).toMatchObject({ group: "B", total: 2, fewData: true });
  });

  it("el puntaje 7 cuenta y el límite de pocos datos es 5", () => {
    const four = portalStatsRows(
      Array.from({ length: 4 }, () => row("A", { score: 7 })),
      { minForStats: 5 },
    );
    expect(four[0]!.fewData).toBe(true);
    const five = portalStatsRows(
      Array.from({ length: 5 }, () => row("A", { score: 7 })),
      { minForStats: 5 },
    );
    expect(five[0]).toMatchObject({ fewData: false, highScore: 5 });
  });

  it("sin filas no hay grupos; empate de total ordena por nombre", () => {
    expect(portalStatsRows([], { minForStats: 5 })).toEqual([]);
    const out = portalStatsRows([row("Z"), row("A")], { minForStats: 5 });
    expect(out.map((r) => r.group)).toEqual(["A", "Z"]);
  });
});
