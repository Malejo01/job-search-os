import { describe, expect, it } from "vitest";
import { GONE_AFTER_DAYS, POOL_FRESH_DAYS, isGoneFromSource } from "./vigencia";

const NOW = new Date("2026-11-26T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

const pool = (over: Partial<Parameters<typeof isGoneFromSource>[0]> = {}) => ({
  fromPool: true,
  lastSeenAt: daysAgo(1),
  poolNewestSeenAt: daysAgo(0),
  now: NOW,
  ...over,
});

describe("isGoneFromSource (R30-07)", () => {
  it("una oferta que no viene del pool: no se afirma nada", () => {
    expect(isGoneFromSource(pool({ fromPool: false, lastSeenAt: daysAgo(90) }))).toBe(false);
  });

  it("vista hace poco: sigue figurando", () => {
    expect(isGoneFromSource(pool({ lastSeenAt: daysAgo(2) }))).toBe(false);
  });

  it("justo en el límite todavía figura; pasado el límite, ya no", () => {
    expect(isGoneFromSource(pool({ lastSeenAt: daysAgo(GONE_AFTER_DAYS) }))).toBe(false);
    expect(isGoneFromSource(pool({ lastSeenAt: daysAgo(GONE_AFTER_DAYS + 0.01) }))).toBe(true);
  });

  it("sin fecha de última vez vista: no se afirma nada", () => {
    expect(isGoneFromSource(pool({ lastSeenAt: null }))).toBe(false);
  });

  it("si el pool entero dejó de actualizarse, no se culpa al aviso", () => {
    expect(
      isGoneFromSource(
        pool({ lastSeenAt: daysAgo(20), poolNewestSeenAt: daysAgo(POOL_FRESH_DAYS + 1) }),
      ),
    ).toBe(false);
  });

  it("sin dato de cuándo se actualizó el pool: no se afirma nada", () => {
    expect(isGoneFromSource(pool({ lastSeenAt: daysAgo(20), poolNewestSeenAt: null }))).toBe(false);
  });

  it("fechas inválidas fallan cerrado (no se afirma)", () => {
    expect(isGoneFromSource(pool({ lastSeenAt: new Date("x") }))).toBe(false);
  });
});
