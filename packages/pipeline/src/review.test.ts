import { describe, expect, it } from "vitest";
import {
  ACTED_STATUSES,
  DEFAULT_TIMEZONE,
  isVerde,
  neighbors,
  parsePeriod,
  periodStart,
  resolveSince,
  reviewProgress,
  startOfDayInZone,
} from "./review";

const SALTA = "America/Argentina/Salta";

describe("startOfDayInZone: medianoche del día en la zona del perfil, no en UTC (JS-061)", () => {
  it("en Salta (UTC−3) el día arranca a las 03:00 UTC", () => {
    expect(startOfDayInZone("2026-09-26", SALTA).toISOString()).toBe("2026-09-26T03:00:00.000Z");
  });

  it("en UTC es la medianoche UTC", () => {
    expect(startOfDayInZone("2026-09-26", "UTC").toISOString()).toBe("2026-09-26T00:00:00.000Z");
  });

  it("no hardcodea el offset: respeta el horario de verano de la zona", () => {
    // Nueva York: UTC−4 en julio (EDT), UTC−5 en enero (EST)
    expect(startOfDayInZone("2026-07-01", "America/New_York").toISOString()).toBe(
      "2026-07-01T04:00:00.000Z",
    );
    expect(startOfDayInZone("2026-01-15", "America/New_York").toISOString()).toBe(
      "2026-01-15T05:00:00.000Z",
    );
  });

  it("la zona por defecto es la del perfil de Mauro", () => {
    expect(DEFAULT_TIMEZONE).toBe(SALTA);
  });
});

describe("periodStart: atajos hoy / esta semana", () => {
  it("'hoy' es el día calendario en la zona, aunque en UTC ya sea mañana", () => {
    // 02:30 UTC del 26 = 23:30 del 25 en Salta: "hoy" es el 25
    const now = new Date("2026-09-26T02:30:00Z");
    expect(periodStart("hoy", now, SALTA)?.toISOString()).toBe("2026-09-25T03:00:00.000Z");
  });

  it("'hoy' al mediodía es la medianoche de ese mismo día", () => {
    const now = new Date("2026-09-26T15:00:00Z"); // sábado 12:00 en Salta
    expect(periodStart("hoy", now, SALTA)?.toISOString()).toBe("2026-09-26T03:00:00.000Z");
  });

  it("'semana' arranca el lunes", () => {
    const sabado = new Date("2026-09-26T15:00:00Z");
    expect(periodStart("semana", sabado, SALTA)?.toISOString()).toBe("2026-09-21T03:00:00.000Z");
  });

  it("un lunes, 'semana' es ese mismo lunes", () => {
    const lunes = new Date("2026-09-21T15:00:00Z");
    expect(periodStart("semana", lunes, SALTA)?.toISOString()).toBe("2026-09-21T03:00:00.000Z");
  });

  it("un domingo, 'semana' es el lunes de 6 días antes (la semana no arranca el domingo)", () => {
    const domingo = new Date("2026-09-27T15:00:00Z");
    expect(periodStart("semana", domingo, SALTA)?.toISOString()).toBe("2026-09-21T03:00:00.000Z");
  });

  it("el lunes se calcula en la zona: el domingo 23:30 en Salta todavía es la semana anterior", () => {
    // 02:30 UTC del lunes 28 = domingo 27 23:30 en Salta
    const now = new Date("2026-09-28T02:30:00Z");
    expect(periodStart("semana", now, SALTA)?.toISOString()).toBe("2026-09-21T03:00:00.000Z");
  });

  it("sin período no hay límite", () => {
    expect(periodStart(null, new Date(), SALTA)).toBeNull();
  });
});

describe("parsePeriod", () => {
  it("acepta hoy y semana; cualquier otra cosa es 'todas' (null)", () => {
    expect(parsePeriod("hoy")).toBe("hoy");
    expect(parsePeriod("semana")).toBe("semana");
    expect(parsePeriod("")).toBeNull();
    expect(parsePeriod("todas")).toBeNull();
    expect(parsePeriod("mes")).toBeNull();
  });
});

describe("resolveSince: combina el atajo con el Desde manual", () => {
  const now = new Date("2026-09-26T15:00:00Z"); // sábado

  it("solo el Desde manual: medianoche de ese día en la zona", () => {
    expect(resolveSince({ periodo: null, desde: "2026-09-10" }, now, SALTA)?.toISOString()).toBe(
      "2026-09-10T03:00:00.000Z",
    );
  });

  it("solo el atajo", () => {
    expect(resolveSince({ periodo: "hoy", desde: null }, now, SALTA)?.toISOString()).toBe(
      "2026-09-26T03:00:00.000Z",
    );
  });

  it("los dos: gana el más reciente (el filtro más restrictivo)", () => {
    // semana = lunes 21; desde = 24 → gana el 24
    expect(
      resolveSince({ periodo: "semana", desde: "2026-09-24" }, now, SALTA)?.toISOString(),
    ).toBe("2026-09-24T03:00:00.000Z");
    // semana = lunes 21; desde = 10 → gana el 21
    expect(
      resolveSince({ periodo: "semana", desde: "2026-09-10" }, now, SALTA)?.toISOString(),
    ).toBe("2026-09-21T03:00:00.000Z");
  });

  it("ninguno: sin límite", () => {
    expect(resolveSince({ periodo: null, desde: null }, now, SALTA)).toBeNull();
  });
});

describe("reviewProgress: 'X de Y verdes revisadas'", () => {
  it("verde es aplicar o aplicar_personalizado; guardar y descartar no cuentan", () => {
    expect(isVerde("aplicar")).toBe(true);
    expect(isVerde("aplicar_personalizado")).toBe(true);
    expect(isVerde("guardar")).toBe(false);
    expect(isVerde("descartar")).toBe(false);
    expect(isVerde(null)).toBe(false);
  });

  it("revisada = tiene una acción tomada; mirarla y dejarla en evaluada no cuenta", () => {
    const p = reviewProgress([
      { status: "aplicada", accion: "aplicar" }, // verde, revisada
      { status: "descartada", accion: "aplicar_personalizado" }, // verde, revisada
      { status: "evaluada", accion: "aplicar" }, // verde, pendiente
      { status: "evaluada", accion: "guardar" }, // no es verde
      { status: "descartada", accion: "descartar" }, // no es verde
    ]);
    expect(p).toEqual({ total: 3, revisadas: 2 });
  });

  it("los estados sin acción tomada no cuentan como revisadas aunque no sean evaluada", () => {
    // Una verde que volvió a la cola (pendiente de JD o recién ingresada) sigue sin revisar
    const p = reviewProgress([
      { status: "pendiente_jd", accion: "aplicar" },
      { status: "prefiltrada", accion: "aplicar" },
      { status: "nueva", accion: "aplicar" },
    ]);
    expect(p).toEqual({ total: 3, revisadas: 0 });
  });

  it("todos los estados de acción tomada cuentan", () => {
    for (const status of ACTED_STATUSES) {
      expect(reviewProgress([{ status, accion: "aplicar" }]), status).toEqual({
        total: 1,
        revisadas: 1,
      });
    }
  });

  it("sin verdes: 0 de 0", () => {
    expect(reviewProgress([])).toEqual({ total: 0, revisadas: 0 });
  });
});

describe("neighbors: anterior y siguiente dentro de la lista ordenada", () => {
  const ids = ["a", "b", "c"];

  it("en el medio", () => {
    expect(neighbors(ids, "b")).toEqual({ prev: "a", next: "c" });
  });

  it("en los bordes no hay anterior ni siguiente", () => {
    expect(neighbors(ids, "a")).toEqual({ prev: null, next: "b" });
    expect(neighbors(ids, "c")).toEqual({ prev: "b", next: null });
  });

  it("si la actual no está (ya no matchea el filtro) no inventa vecinos", () => {
    expect(neighbors(ids, "z")).toEqual({ prev: null, next: null });
  });

  it("una sola oferta: sin vecinos", () => {
    expect(neighbors(["a"], "a")).toEqual({ prev: null, next: null });
  });
});
