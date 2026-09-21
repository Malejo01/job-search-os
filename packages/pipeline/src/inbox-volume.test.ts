import { describe, expect, it } from "vitest";
import { assessInboxVolume } from "./inbox-volume";

const normal = {
  last24h: 13,
  last24hNoParser: 5,
  rejectedLast24h: 0,
  previousDays: [12, 14, 11, 13, 15, 10, 12],
};

describe("volumen de /inbox (JS-038)", () => {
  it("un día normal no avisa", () => {
    expect(assessInboxVolume(normal)).toMatchObject({ level: "ok", reasons: [] });
  });

  it("emails rechazados por el límite de 100/hora: siempre avisa, porque se perdieron", () => {
    const r = assessInboxVolume({ ...normal, rejectedLast24h: 7 });
    expect(r.level).toBe("alto");
    expect(r.reasons.join(" ")).toMatch(/7 emails rechazados/);
  });

  it("pico: muchos más que el promedio de los 7 días anteriores", () => {
    const r = assessInboxVolume({ ...normal, last24h: 60, last24hNoParser: 10 });
    expect(r.level).toBe("alto");
    expect(r.reasons.join(" ")).toMatch(/60 en 24 h.*promedio de 12/);
  });

  it("un pico chico no avisa aunque multiplique el promedio (pocos emails en total)", () => {
    const r = assessInboxVolume({ ...normal, last24h: 9, previousDays: [1, 2, 1, 2, 1, 2, 1] });
    expect(r.level).toBe("ok");
  });

  it("casi todo sin parser: probablemente llega correo que no es de empleo (reenvío de más en Gmail)", () => {
    const r = assessInboxVolume({ ...normal, last24h: 30, last24hNoParser: 28 });
    expect(r.level).toBe("alto");
    expect(r.reasons.join(" ")).toMatch(/28 de 30 sin parser/);
  });

  it("sin historia (primera semana) usa 1 por día como piso del promedio", () => {
    const r = assessInboxVolume({
      last24h: 40,
      last24hNoParser: 5,
      rejectedLast24h: 0,
      previousDays: [],
    });
    expect(r).toMatchObject({ level: "alto", averagePerDay: 0 });
  });
});
