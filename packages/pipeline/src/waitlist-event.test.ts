import { describe, expect, it } from "vitest";
import {
  WAITLIST_EVENT_MAX_HOURS,
  parseWaitlistEventWindow,
  waitlistEventApplies,
} from "./waitlist-event";

const RAW = "2026-11-11T17:00:00-03:00/2026-11-11T23:00:00-03:00";

describe("parseWaitlistEventWindow", () => {
  it("sin variable no hay ventana (apagado por defecto)", () => {
    expect(parseWaitlistEventWindow(undefined)).toBeNull();
    expect(parseWaitlistEventWindow("")).toBeNull();
  });

  it("lee inicio/fin con zona horaria explícita", () => {
    const w = parseWaitlistEventWindow(RAW)!;
    expect(w.start.toISOString()).toBe("2026-11-11T20:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-11-12T02:00:00.000Z");
  });

  it("falla cerrado: sin zona, al revés, mal formada o más larga que el máximo", () => {
    expect(parseWaitlistEventWindow("2026-11-11T17:00:00/2026-11-11T23:00:00")).toBeNull();
    expect(
      parseWaitlistEventWindow("2026-11-11T23:00:00-03:00/2026-11-11T17:00:00-03:00"),
    ).toBeNull();
    expect(parseWaitlistEventWindow("mañana")).toBeNull();
    expect(parseWaitlistEventWindow("2026-11-11T17:00:00-03:00")).toBeNull();
    expect(
      parseWaitlistEventWindow("2026-11-11T08:00:00-03:00/2026-11-11T21:00:00-03:00"),
    ).toBeNull();
    expect(WAITLIST_EVENT_MAX_HOURS).toBe(12);
  });
});

describe("waitlistEventApplies", () => {
  const w = parseWaitlistEventWindow(RAW);
  const during = new Date("2026-11-11T21:30:00Z");

  it("solo con el origen del QR y dentro de la ventana", () => {
    expect(waitlistEventApplies(w, during, "voces-jovenes")).toBe(true);
    expect(waitlistEventApplies(w, during, " Voces-Jovenes ")).toBe(true);
    expect(waitlistEventApplies(w, during, null)).toBe(false);
    expect(waitlistEventApplies(w, during, "instagram")).toBe(false);
  });

  it("fuera de la ventana o sin ventana, nunca", () => {
    expect(waitlistEventApplies(w, new Date("2026-11-11T19:59:59Z"), "voces-jovenes")).toBe(false);
    expect(waitlistEventApplies(w, new Date("2026-11-12T02:00:00Z"), "voces-jovenes")).toBe(false);
    expect(waitlistEventApplies(null, during, "voces-jovenes")).toBe(false);
  });
});
