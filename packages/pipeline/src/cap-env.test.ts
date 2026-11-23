import { describe, expect, it } from "vitest";
import {
  readCap,
  readCapChecked,
  INTERVIEW_MAX_SIMULATIONS_PER_DAY,
  interviewMaxSimulationsPerDay,
  decideInterviewStart,
  cvChatLimitsFromEnv,
  CV_CHAT_MAX_COST_USD,
  CV_CHAT_USER_DAILY_CAP_USD,
  CV_CHAT_MAX_STARTS_PER_DAY,
  cvChatCapReason,
  cvChatStartCapReason,
  profileAgentLimitsFromEnv,
  profileAgentCapReason,
  PROFILE_AGENT_MAX_FLOW_COST_USD,
  PROFILE_AGENT_MAX_READS_PER_DAY,
  PROFILE_AGENT_USER_DAILY_CAP_USD,
  cvCoachMaxFlowCostUsd,
  CV_COACH_MAX_FLOW_COST_USD,
  cvCoachCapReason,
  FEEDBACK_DAILY_LIMIT,
  feedbackDailyLimit,
  isOverDailyLimit,
} from "./index";

describe("readCap", () => {
  it("sin variable o vacía usa el default", () => {
    expect(readCap({}, "X", 7, { kind: "int" })).toBe(7);
    expect(readCap({ X: "" }, "X", 7, { kind: "int" })).toBe(7);
    expect(readCap({ X: "   " }, "X", 7, { kind: "int" })).toBe(7);
  });
  it("entero válido", () => {
    expect(readCap({ X: "12" }, "X", 7, { kind: "int" })).toBe(12);
    expect(readCap({ X: " 3 " }, "X", 7, { kind: "int" })).toBe(3);
  });
  it("decimal válido (punto) y entero como decimal", () => {
    expect(readCap({ X: "0.25" }, "X", 1, { kind: "decimal" })).toBe(0.25);
    expect(readCap({ X: "2" }, "X", 1, { kind: "decimal" })).toBe(2);
  });
  it("inválido cae al default y no rompe", () => {
    for (const bad of [
      "abc",
      "-1",
      "0",
      "0.0",
      "1e3",
      "NaN",
      "Infinity",
      "1,5",
      "--2",
      "1.2.3",
      "0x10",
    ]) {
      expect(readCap({ X: bad }, "X", 7, { kind: "decimal" }), bad).toBe(7);
    }
  });
  it("un decimal no vale para un entero", () => {
    expect(readCap({ X: "2.5" }, "X", 7, { kind: "int" })).toBe(7);
  });
  it("respeta el máximo opcional", () => {
    expect(readCap({ X: "50" }, "X", 7, { kind: "int", max: 50 })).toBe(50);
    expect(readCap({ X: "51" }, "X", 7, { kind: "int", max: 50 })).toBe(7);
  });
  it("readCapChecked informa el origen", () => {
    expect(readCapChecked({}, "X", 7, { kind: "int" })).toEqual({ value: 7, source: "default" });
    expect(readCapChecked({ X: "9" }, "X", 7, { kind: "int" })).toEqual({
      value: 9,
      source: "env",
    });
    expect(readCapChecked({ X: "no" }, "X", 7, { kind: "int" })).toEqual({
      value: 7,
      source: "invalid",
    });
  });
});

describe("Interview: simulaciones por día", () => {
  it("default 2, variable válida e inválida", () => {
    expect(interviewMaxSimulationsPerDay({})).toBe(INTERVIEW_MAX_SIMULATIONS_PER_DAY);
    expect(INTERVIEW_MAX_SIMULATIONS_PER_DAY).toBe(2);
    expect(interviewMaxSimulationsPerDay({ INTERVIEW_MAX_SIMULATIONS_PER_DAY: "4" })).toBe(4);
    expect(interviewMaxSimulationsPerDay({ INTERVIEW_MAX_SIMULATIONS_PER_DAY: "x" })).toBe(2);
  });
  it("decideInterviewStart usa el máximo pasado", () => {
    expect(decideInterviewStart(2, 4)).toEqual({ ok: true, left: 2 });
    expect(decideInterviewStart(4, 4)).toEqual({ ok: false, reason: "daily_limit" });
    expect(decideInterviewStart(2)).toEqual({ ok: false, reason: "daily_limit" });
  });
});

describe("chat de CV: topes por persona", () => {
  it("defaults", () => {
    expect(cvChatLimitsFromEnv({})).toEqual({
      maxCostUsd: 0.15,
      userDailyCapUsd: 0.3,
      maxStartsPerDay: 5,
    });
    expect(CV_CHAT_MAX_COST_USD).toBe(0.15);
    expect(CV_CHAT_USER_DAILY_CAP_USD).toBe(0.3);
    expect(CV_CHAT_MAX_STARTS_PER_DAY).toBe(5);
  });
  it("variables válidas", () => {
    expect(
      cvChatLimitsFromEnv({
        CV_CHAT_MAX_COST_USD: "0.2",
        CV_CHAT_USER_DAILY_CAP_USD: "0.4",
        CV_CHAT_MAX_STARTS_PER_DAY: "8",
      }),
    ).toEqual({ maxCostUsd: 0.2, userDailyCapUsd: 0.4, maxStartsPerDay: 8 });
  });
  it("variables inválidas caen al default", () => {
    expect(
      cvChatLimitsFromEnv({
        CV_CHAT_MAX_COST_USD: "-1",
        CV_CHAT_USER_DAILY_CAP_USD: "mucho",
        CV_CHAT_MAX_STARTS_PER_DAY: "2.5",
      }),
    ).toEqual({ maxCostUsd: 0.15, userDailyCapUsd: 0.3, maxStartsPerDay: 5 });
  });
  it("las decisiones usan los topes pasados", () => {
    const base = {
      turns: 0,
      conversationCostUsd: 0.2,
      cvThisMonth: 0,
      cvPerMonth: 1,
      userInterviewSpendUsd: 0.35,
      dailySpendUsd: 0,
      dailyCapUsd: 1,
    };
    expect(cvChatCapReason(base)).toBe("conversacion");
    expect(cvChatCapReason({ ...base, maxCostUsd: 0.25 })).toBe("usuario");
    expect(cvChatCapReason({ ...base, maxCostUsd: 0.25, userDailyCapUsd: 0.5 })).toBeNull();
    expect(cvChatStartCapReason(5)).toBe("inicios");
    expect(cvChatStartCapReason(5, 8)).toBeNull();
    expect(cvChatStartCapReason(8, 8)).toBe("inicios");
  });
});

describe("agente de perfil: topes por persona y charla", () => {
  it("defaults, válida e inválida", () => {
    expect(profileAgentLimitsFromEnv({})).toEqual({
      maxReadsPerDay: 3,
      maxFlowCostUsd: 0.3,
      userDailyCapUsd: 0.5,
    });
    expect(PROFILE_AGENT_MAX_READS_PER_DAY).toBe(3);
    expect(PROFILE_AGENT_MAX_FLOW_COST_USD).toBe(0.3);
    expect(PROFILE_AGENT_USER_DAILY_CAP_USD).toBe(0.5);
    expect(
      profileAgentLimitsFromEnv({
        CV_PROFILE_AGENT_MAX_READS_PER_DAY: "5",
        CV_PROFILE_AGENT_MAX_FLOW_COST_USD: "0.4",
        CV_PROFILE_AGENT_USER_DAILY_CAP_USD: "0.75",
      }),
    ).toEqual({ maxReadsPerDay: 5, maxFlowCostUsd: 0.4, userDailyCapUsd: 0.75 });
    expect(
      profileAgentLimitsFromEnv({
        CV_PROFILE_AGENT_MAX_READS_PER_DAY: "0",
        CV_PROFILE_AGENT_MAX_FLOW_COST_USD: "x",
        CV_PROFILE_AGENT_USER_DAILY_CAP_USD: "",
      }),
    ).toEqual({ maxReadsPerDay: 3, maxFlowCostUsd: 0.3, userDailyCapUsd: 0.5 });
  });
  it("profileAgentCapReason usa los topes pasados", () => {
    const base = {
      stage: "read" as const,
      exempt: false,
      readsThisMonth: 0,
      readsPerMonth: 3,
      readsToday: 3,
      gapTurns: 0,
      flowCostUsd: 0,
      userSpendTodayUsd: 0.6,
      dailySpendUsd: 0,
      dailyCapUsd: 1,
    };
    expect(profileAgentCapReason(base)).toBe("lecturas_dia");
    expect(profileAgentCapReason({ ...base, maxReadsPerDay: 4 })).toBe("usuario");
    expect(profileAgentCapReason({ ...base, maxReadsPerDay: 4, userDailyCapUsd: 0.7 })).toBeNull();
  });
});

describe("coach de CV: tope de la charla", () => {
  it("default, válida e inválida", () => {
    expect(cvCoachMaxFlowCostUsd({})).toBe(CV_COACH_MAX_FLOW_COST_USD);
    expect(CV_COACH_MAX_FLOW_COST_USD).toBe(0.3);
    expect(cvCoachMaxFlowCostUsd({ CV_COACH_MAX_FLOW_COST_USD: "0.5" })).toBe(0.5);
    expect(cvCoachMaxFlowCostUsd({ CV_COACH_MAX_FLOW_COST_USD: "-3" })).toBe(0.3);
  });
  it("cvCoachCapReason usa el tope pasado", () => {
    const i = { step: "turn" as const, turns: 0, reviews: 0, flowCostUsd: 0.2, written: false };
    expect(cvCoachCapReason(i)).toBe("charla");
    expect(cvCoachCapReason({ ...i, maxFlowCostUsd: 0.5 })).toBeNull();
  });
});

describe("feedback: tope diario", () => {
  it("default, válida e inválida", () => {
    expect(feedbackDailyLimit({})).toBe(FEEDBACK_DAILY_LIMIT);
    expect(FEEDBACK_DAILY_LIMIT).toBe(10);
    expect(feedbackDailyLimit({ FEEDBACK_DAILY_LIMIT: "20" })).toBe(20);
    expect(feedbackDailyLimit({ FEEDBACK_DAILY_LIMIT: "diez" })).toBe(10);
    expect(isOverDailyLimit(10)).toBe(true);
    expect(isOverDailyLimit(10, 20)).toBe(false);
  });
});
