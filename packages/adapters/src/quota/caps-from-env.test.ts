import { describe, expect, it } from "vitest";
import { coachLimitsFromEnv, decideCvCoachStep } from "../cv-coach/reserve";
import { decideGapStep } from "../profile-agent/gaps/reserve";
import {
  extractJobFromImage,
  IMAGE_ATTEMPTS_DAILY_LIMIT,
  IMAGE_DAILY_LIMIT,
  imageLimitsFromEnv,
  type ExtractImageDeps,
} from "../llm/extract-job-image";

describe("imageLimitsFromEnv", () => {
  it("default sin variable", () => {
    expect(imageLimitsFromEnv({})).toEqual({ daily: 10, attempts: 30 });
    expect(IMAGE_DAILY_LIMIT).toBe(10);
    expect(IMAGE_ATTEMPTS_DAILY_LIMIT).toBe(30);
  });
  it("variable válida", () => {
    expect(
      imageLimitsFromEnv({ IMAGE_DAILY_LIMIT: "12", IMAGE_ATTEMPTS_DAILY_LIMIT: "40" }),
    ).toEqual({
      daily: 12,
      attempts: 40,
    });
  });
  it("variable inválida cae al default", () => {
    expect(
      imageLimitsFromEnv({ IMAGE_DAILY_LIMIT: "-1", IMAGE_ATTEMPTS_DAILY_LIMIT: "x" }),
    ).toEqual({
      daily: 10,
      attempts: 30,
    });
  });
});

function imageDeps(used: number, attempts: number, limits?: ExtractImageDeps["limits"]) {
  // JPEG mínimo inventado con estructura válida (SOI, SOF0, SOS, EOI)
  const png = new Uint8Array(1000);
  png.set([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x02, 0x58, 0x03, 0x20, 0x01, 0x01, 0x11, 0x00, 0xff,
    0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
  ]);
  png.set([0xff, 0xd9], png.length - 2);
  const deps = {
    llm: {
      generateStructured: async () => {
        throw new Error("no debería llamar al modelo");
      },
    },
    countSince: async () => used,
    countAttemptsSince: async () => attempts,
    capReason: async () => "global" as const,
    lock: { acquire: async () => true, release: async () => {} },
    ...(limits ? { limits } : {}),
  } as unknown as ExtractImageDeps;
  return { deps, input: { userId: "u1", image: png } };
}

describe("extractJobFromImage con topes operables", () => {
  it("sin limits rige el default (10): con 10 usadas corta", async () => {
    const { deps, input } = imageDeps(10, 0);
    expect(await extractJobFromImage(deps, input)).toEqual({ ok: false, code: "limite_imagenes" });
  });
  it("con limits.daily mayor, 10 usadas pasa al siguiente paso (el tope de gasto)", async () => {
    const { deps, input } = imageDeps(10, 0, { daily: 12 });
    expect(await extractJobFromImage(deps, input)).toEqual({ ok: false, code: "tope_global" });
  });
  it("limits.attempts se respeta", async () => {
    const a = imageDeps(0, 30);
    expect(await extractJobFromImage(a.deps, a.input)).toEqual({
      ok: false,
      code: "limite_imagenes",
    });
    const b = imageDeps(0, 30, { attempts: 31 });
    expect(await extractJobFromImage(b.deps, b.input)).toEqual({ ok: false, code: "tope_global" });
  });
});

describe("decideGapStep con topes operables", () => {
  const m = {
    gapTurns: 0,
    flowCostUsd: 0,
    userSpendTodayUsd: 0.6,
    dailySpendUsd: 0,
    startsToday: 5,
  };
  it("default: 5 charlas por día y USD 0,50 por persona", () => {
    expect(decideGapStep("start", m, 1)).toBe("inicios");
    expect(decideGapStep("turn", m, 1)).toBe("usuario");
  });
  it("con topes pasados", () => {
    expect(decideGapStep("start", m, 1, { maxStartsPerDay: 8, userDailyCapUsd: 0.7 })).toBeNull();
    expect(
      decideGapStep("turn", { ...m, flowCostUsd: 0.35 }, 1, {
        maxFlowCostUsd: 0.5,
        userDailyCapUsd: 0.7,
      }),
    ).toBeNull();
  });
});

describe("decideCvCoachStep con topes operables", () => {
  const m = {
    turns: 0,
    reviews: 0,
    flowCostUsd: 0.2,
    written: false,
    userSpendTodayUsd: 0,
    dailySpendUsd: 0,
  };
  it("default: la charla corta cerca de USD 0,30", () => {
    expect(decideCvCoachStep("turn", m, 1)).toBe("charla");
  });
  it("coachLimitsFromEnv: default, válido e inválido", () => {
    expect(coachLimitsFromEnv({})).toEqual({ maxFlowCostUsd: 0.3, userDailyCapUsd: 0.5 });
    expect(
      coachLimitsFromEnv({
        CV_COACH_MAX_FLOW_COST_USD: "0.6",
        CV_PROFILE_AGENT_USER_DAILY_CAP_USD: "0.9",
      }),
    ).toEqual({ maxFlowCostUsd: 0.6, userDailyCapUsd: 0.9 });
    expect(
      coachLimitsFromEnv({
        CV_COACH_MAX_FLOW_COST_USD: "no",
        CV_PROFILE_AGENT_USER_DAILY_CAP_USD: "-2",
      }),
    ).toEqual({ maxFlowCostUsd: 0.3, userDailyCapUsd: 0.5 });
  });
  it("con el tope de la charla subido, el turno pasa (también el check compartido del agente)", () => {
    expect(decideCvCoachStep("turn", m, 1, { maxFlowCostUsd: 0.6 })).toBeNull();
  });
});
