import { describe, expect, it } from "vitest";
import {
  ACCESO_FUNNEL_STEPS,
  buildAccesoFunnel,
  normalizeAccesoOrigin,
  parseAccesoFunnelRows,
  type AccesoFunnelRow,
} from "./acceso-funnel";

const row = (over: Partial<AccesoFunnelRow>): AccesoFunnelRow => ({
  hour: "2026-11-11T21:00:00.000Z",
  origin: "voces-jovenes",
  step: "visita",
  role: "",
  count: 1,
  ...over,
});

describe("normalizeAccesoOrigin", () => {
  it("sin origen es «directo»", () => {
    expect(normalizeAccesoOrigin(null)).toBe("directo");
    expect(normalizeAccesoOrigin("")).toBe("directo");
    expect(normalizeAccesoOrigin("   ")).toBe("directo");
  });

  it("los orígenes conocidos pasan normalizados", () => {
    expect(normalizeAccesoOrigin("voces-jovenes")).toBe("voces-jovenes");
    expect(normalizeAccesoOrigin(" Voces-Jovenes ")).toBe("voces-jovenes");
    expect(normalizeAccesoOrigin("instagram")).toBe("instagram");
  });

  it("cualquier otro valor cae en «otro» (sin texto libre en la base)", () => {
    expect(normalizeAccesoOrigin("mi-email@ejemplo.com")).toBe("otro");
    expect(normalizeAccesoOrigin("x".repeat(500))).toBe("otro");
    expect(normalizeAccesoOrigin("<script>")).toBe("otro");
  });
});

describe("parseAccesoFunnelRows", () => {
  it("acepta filas válidas y convierte la hora a ISO", () => {
    const parsed = parseAccesoFunnelRows([
      {
        hour: new Date("2026-11-11T21:00:00Z"),
        origin: "directo",
        step: "visita",
        role: "",
        count: "3",
      },
    ]);
    expect(parsed).toEqual([row({ origin: "directo", count: 3 })]);
  });

  it("descarta la entrada entera si una fila no tiene la forma esperada", () => {
    expect(
      parseAccesoFunnelRows([{ hour: "x", origin: "directo", step: "visita", role: "", count: 1 }]),
    ).toBeNull();
    expect(parseAccesoFunnelRows([row({ step: "inventado" as never })])).toBeNull();
    expect(parseAccesoFunnelRows([row({ count: -1 })])).toBeNull();
    expect(parseAccesoFunnelRows("no")).toBeNull();
  });
});

describe("buildAccesoFunnel", () => {
  const rows: AccesoFunnelRow[] = [
    row({ step: "visita", count: 50 }),
    row({ step: "empezado", count: 30 }),
    row({ step: "carrera", role: "abogacia", count: 12 }),
    row({ step: "carrera", role: "finanzas_contabilidad", count: 10 }),
    row({ step: "enviado", role: "abogacia", count: 9 }),
    row({ step: "enviado", role: "finanzas_contabilidad", count: 5 }),
    row({ step: "tope", count: 2 }),
    row({ hour: "2026-11-11T22:00:00.000Z", step: "visita", count: 8 }),
    row({ hour: "2026-11-11T22:00:00.000Z", step: "enviado", role: "abogacia", count: 1 }),
    row({ origin: "directo", step: "visita", count: 4 }),
  ];

  it("suma por origen y calcula la conversión de visita a envío", () => {
    const f = buildAccesoFunnel(rows);
    const vj = f.byOrigin.find((o) => o.origin === "voces-jovenes")!;
    expect(vj).toMatchObject({ visita: 58, empezado: 30, enviado: 15, tope: 2 });
    expect(vj.conversion).toBeCloseTo(15 / 58);
    const directo = f.byOrigin.find((o) => o.origin === "directo")!;
    expect(directo).toMatchObject({ visita: 4, enviado: 0, conversion: 0 });
    // El origen con más visitas primero
    expect(f.byOrigin[0]!.origin).toBe("voces-jovenes");
  });

  it("conversión por carrera elegida = envíos / veces que se eligió", () => {
    const f = buildAccesoFunnel(rows);
    const abogacia = f.byRole.find((r) => r.role === "abogacia")!;
    expect(abogacia).toMatchObject({ carrera: 12, enviado: 10 });
    expect(abogacia.conversion).toBeCloseTo(10 / 12);
  });

  it("sin elecciones registradas la conversión es null, no infinito", () => {
    const f = buildAccesoFunnel([row({ step: "enviado", role: "abogacia", count: 2 })]);
    expect(f.byRole[0]!.conversion).toBeNull();
  });

  it("por hora, en orden, con la hora pico", () => {
    const f = buildAccesoFunnel(rows);
    expect(f.byHour.map((h) => h.hour)).toEqual([
      "2026-11-11T21:00:00.000Z",
      "2026-11-11T22:00:00.000Z",
    ]);
    expect(f.byHour[0]).toMatchObject({ visita: 54, empezado: 30, enviado: 14, tope: 2 });
    expect(f.peakHour).toBe("2026-11-11T21:00:00.000Z");
  });

  it("filtra por origen", () => {
    const f = buildAccesoFunnel(rows, { origin: "directo" });
    expect(f.byOrigin).toHaveLength(1);
    expect(f.byHour[0]!.visita).toBe(4);
    expect(f.byRole).toEqual([]);
  });

  it("vacío no rompe", () => {
    const f = buildAccesoFunnel([]);
    expect(f).toEqual({
      byOrigin: [],
      byRole: [],
      byHour: [],
      peakHour: null,
      totals: expect.any(Object),
    });
    expect(ACCESO_FUNNEL_STEPS).toContain("tope");
  });
});
