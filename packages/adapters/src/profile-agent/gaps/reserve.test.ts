import {
  CV_CHAT_MAX_STARTS_PER_DAY,
  PROFILE_AGENT_MAX_FLOW_COST_USD,
  PROFILE_AGENT_MAX_GAP_TURNS,
  PROFILE_AGENT_USER_DAILY_CAP_USD,
} from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import { decideGapStep, type GapMeasures } from "./reserve";

const calm: GapMeasures = {
  gapTurns: 0,
  flowCostUsd: 0,
  userSpendTodayUsd: 0,
  dailySpendUsd: 0,
  startsToday: 0,
};
const m = (over: Partial<GapMeasures>): GapMeasures => ({ ...calm, ...over });

describe("decideGapStep", () => {
  it("sin nada medido, todos los pasos pasan", () => {
    for (const step of ["turn", "check", "start"] as const) {
      expect(decideGapStep(step, calm, 1)).toBeNull();
    }
  });

  it("el tope de turnos frena nuevas llamadas, no el cierre ni el cambio de charla", () => {
    const full = m({ gapTurns: PROFILE_AGENT_MAX_GAP_TURNS });
    expect(decideGapStep("turn", full, 1)).toBe("turnos");
    expect(decideGapStep("check", full, 1)).toBeNull();
    expect(decideGapStep("start", full, 1)).toBeNull();
  });

  it("el `start` cuenta en los 5 por día del chat de CV", () => {
    expect(
      decideGapStep("start", m({ startsToday: CV_CHAT_MAX_STARTS_PER_DAY - 1 }), 1),
    ).toBeNull();
    expect(decideGapStep("start", m({ startsToday: CV_CHAT_MAX_STARTS_PER_DAY }), 1)).toBe(
      "inicios",
    );
    // el tope de inicios no frena turnos de una charla que ya empezó
    expect(decideGapStep("turn", m({ startsToday: CV_CHAT_MAX_STARTS_PER_DAY }), 1)).toBeNull();
  });

  it("los topes de USD rigen siempre: charla, persona y día global (no hay exención)", () => {
    expect(decideGapStep("turn", m({ flowCostUsd: PROFILE_AGENT_MAX_FLOW_COST_USD }), 1)).toBe(
      "charla",
    );
    expect(
      decideGapStep("turn", m({ userSpendTodayUsd: PROFILE_AGENT_USER_DAILY_CAP_USD }), 1),
    ).toBe("usuario");
    expect(decideGapStep("check", m({ dailySpendUsd: 1 }), 1)).toBe("global");
    expect(
      decideGapStep("start", m({ userSpendTodayUsd: PROFILE_AGENT_USER_DAILY_CAP_USD }), 1),
    ).toBe("usuario");
  });

  it("un tope global mal escrito (0) o una medida inválida cierran", () => {
    expect(decideGapStep("turn", calm, 0)).toBe("global");
    expect(decideGapStep("turn", m({ flowCostUsd: Number.NaN }), 1)).toBe("charla");
    expect(decideGapStep("turn", m({ gapTurns: Number.NaN }), 1)).toBe("turnos");
  });
});
