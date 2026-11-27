import { describe, expect, it } from "vitest";
import {
  JOB_CARD_DEFAULT_DAILY_MAX,
  JOB_CARD_DEFAULT_DAILY_USD,
  JOB_CARD_MAX_ATTEMPTS,
  canRetryJobCard,
  decideJobCardStart,
  jobCardCapsFromEnv,
  jobCardReservationLabel,
} from "./limits";

const caps = { dailyMax: 10, dailyUsd: 1 };
const idle = {
  cardsLast24h: 0,
  usdLast24h: 0,
  reservedCount: 0,
  reservedUsd: 0,
  estimateUsd: 0.05,
};

describe("jobCardCapsFromEnv", () => {
  it("sin variables, valores por defecto bajos y documentados", () => {
    expect(jobCardCapsFromEnv({})).toEqual({
      caps: { dailyMax: JOB_CARD_DEFAULT_DAILY_MAX, dailyUsd: JOB_CARD_DEFAULT_DAILY_USD },
      invalid: [],
    });
    expect(JOB_CARD_DEFAULT_DAILY_MAX).toBeLessThanOrEqual(200);
    expect(JOB_CARD_DEFAULT_DAILY_USD).toBeLessThanOrEqual(2);
  });

  it("lee las dos variables; 0 significa «ninguna ficha nueva» (nunca «sin tope»)", () => {
    expect(
      jobCardCapsFromEnv({ JOB_CARD_DAILY_MAX: "40", JOB_CARD_DAILY_USD: "0.5" }).caps,
    ).toEqual({ dailyMax: 40, dailyUsd: 0.5 });
    expect(jobCardCapsFromEnv({ JOB_CARD_DAILY_MAX: "0" }).caps.dailyMax).toBe(0);
  });

  it("un valor inválido usa el default y se informa (falla cerrado, no abierto)", () => {
    const r = jobCardCapsFromEnv({ JOB_CARD_DAILY_MAX: "muchas", JOB_CARD_DAILY_USD: "-3" });
    expect(r.caps).toEqual({
      dailyMax: JOB_CARD_DEFAULT_DAILY_MAX,
      dailyUsd: JOB_CARD_DEFAULT_DAILY_USD,
    });
    expect(r.invalid).toEqual(["JOB_CARD_DAILY_MAX", "JOB_CARD_DAILY_USD"]);
  });
});

describe("decideJobCardStart", () => {
  it("con margen, sigue", () => {
    expect(decideJobCardStart({ ...idle, caps })).toEqual({ ok: true });
  });

  it("frena por cantidad: las hechas y las que están en curso cuentan", () => {
    expect(decideJobCardStart({ ...idle, caps, cardsLast24h: 10 })).toEqual({
      ok: false,
      reason: "daily_count",
    });
    expect(decideJobCardStart({ ...idle, caps, cardsLast24h: 6, reservedCount: 4 })).toEqual({
      ok: false,
      reason: "daily_count",
    });
    expect(decideJobCardStart({ ...idle, caps, cardsLast24h: 6, reservedCount: 3 }).ok).toBe(true);
  });

  it("frena por gasto: lo gastado más lo reservado más lo que se va a reservar", () => {
    expect(decideJobCardStart({ ...idle, caps, usdLast24h: 0.96 })).toEqual({
      ok: false,
      reason: "daily_usd",
    });
    expect(decideJobCardStart({ ...idle, caps, usdLast24h: 0.5, reservedUsd: 0.46 }).ok).toBe(
      false,
    );
    expect(decideJobCardStart({ ...idle, caps, usdLast24h: 0.9 }).ok).toBe(true);
  });

  it("con un tope en 0 no se genera ninguna", () => {
    expect(decideJobCardStart({ ...idle, caps: { dailyMax: 0, dailyUsd: 1 } }).ok).toBe(false);
    expect(decideJobCardStart({ ...idle, caps: { dailyMax: 5, dailyUsd: 0 } }).ok).toBe(false);
  });

  it("un número no finito frena", () => {
    expect(decideJobCardStart({ ...idle, caps, usdLast24h: Number.NaN }).ok).toBe(false);
  });
});

describe("reintento y etiqueta", () => {
  it("una ficha fallida se reintenta hasta el máximo de intentos", () => {
    expect(canRetryJobCard({ status: "fallida", attempts: 1 })).toBe(true);
    expect(canRetryJobCard({ status: "fallida", attempts: JOB_CARD_MAX_ATTEMPTS })).toBe(false);
    expect(canRetryJobCard({ status: "lista", attempts: 1 })).toBe(false);
    expect(canRetryJobCard({ status: "sin_texto", attempts: 0 })).toBe(false);
  });

  it("la etiqueta lleva el hash y no la persona", () => {
    const h = "ab".repeat(32);
    expect(jobCardReservationLabel(h)).toBe(`job_card:${h}`);
  });
});
