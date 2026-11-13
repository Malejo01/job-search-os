import { describe, expect, it } from "vitest";
import {
  aggregateAssistantDays,
  ASSISTANT_TURN_MARKER,
  average,
  capMarker,
  dayKey,
  isMeasuredCap,
  percentile,
  type ConversationSample,
} from "./metrics";

const NOW = new Date("2026-11-13T15:00:00Z");
const sample = (iso: string, over: Partial<ConversationSample> = {}): ConversationSample => ({
  startedAt: new Date(iso),
  messages: 4,
  costUsd: 0.1,
  capped: false,
  ...over,
});

describe("average y percentile", () => {
  it("promedio de los válidos; sin datos, null", () => {
    expect(average([1, 2, 3])).toBe(2);
    expect(average([])).toBeNull();
    expect(average([NaN, -1])).toBeNull();
  });

  it("p90 por rango más cercano: siempre un valor que existió", () => {
    const xs = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
    expect(percentile(xs, 0.9)).toBe(0.9);
    expect(percentile([5], 0.9)).toBe(5);
    expect(percentile([3, 1, 2], 0.9)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 0.9)).toBe(10);
  });

  it("sin datos o con p inválido, null", () => {
    expect(percentile([], 0.9)).toBeNull();
    expect(percentile([1], 0)).toBeNull();
    expect(percentile([1], 1.5)).toBeNull();
    expect(percentile([NaN], 0.9)).toBeNull();
  });
});

describe("marcadores", () => {
  it("el marcador de corte lleva el motivo y solo cuentan los topes de la charla", () => {
    expect(capMarker("usd")).toBe("cap:usd");
    expect(capMarker("turns")).toBe("cap:turns");
    for (const r of ["turns", "usd", "steps", "input_tokens"] as const) {
      expect(isMeasuredCap(r)).toBe(true);
    }
    for (const r of ["monthly_conversations", "message_too_long", "cost_unknown"] as const) {
      expect(isMeasuredCap(r)).toBe(false);
    }
    expect(ASSISTANT_TURN_MARKER).toBe("turn");
  });
});

describe("dayKey", () => {
  it("respeta el desplazamiento de zona", () => {
    expect(dayKey(new Date("2026-11-13T01:00:00Z"), 0)).toBe("2026-11-13");
    expect(dayKey(new Date("2026-11-13T01:00:00Z"), -180)).toBe("2026-11-12");
  });
});

describe("aggregateAssistantDays", () => {
  it("devuelve siempre los 7 días, del más reciente al más viejo, con ceros", () => {
    const rows = aggregateAssistantDays([], NOW);
    expect(rows).toHaveLength(7);
    expect(rows[0]?.day).toBe("2026-11-13");
    expect(rows[6]?.day).toBe("2026-11-07");
    expect(rows[0]).toEqual({
      day: "2026-11-13",
      conversations: 0,
      messagesAvg: null,
      messagesMax: null,
      costAvgUsd: null,
      costP90Usd: null,
      costUnknown: 0,
      cappedConversations: 0,
    });
  });

  it("agrupa por día y calcula promedio, máximo, p90 y cortes", () => {
    const rows = aggregateAssistantDays(
      [
        sample("2026-11-13T10:00:00Z", { messages: 2, costUsd: 0.1 }),
        sample("2026-11-13T11:00:00Z", { messages: 6, costUsd: 0.3, capped: true }),
        sample("2026-11-12T11:00:00Z", { messages: 20, costUsd: 0.5, capped: true }),
        sample("2026-10-01T11:00:00Z"),
      ],
      NOW,
    );
    expect(rows[0]).toMatchObject({
      conversations: 2,
      messagesAvg: 4,
      messagesMax: 6,
      costP90Usd: 0.3,
      cappedConversations: 1,
    });
    expect(rows[0]?.costAvgUsd).toBeCloseTo(0.2);
    expect(rows[1]).toMatchObject({ conversations: 1, messagesMax: 20, cappedConversations: 1 });
    // Fuera de la ventana: no cuenta
    expect(rows.reduce((n, r) => n + r.conversations, 0)).toBe(3);
  });

  it("costo desconocido no entra al promedio y se cuenta aparte; mensajes sin medir, null", () => {
    const rows = aggregateAssistantDays(
      [
        sample("2026-11-13T10:00:00Z", { costUsd: null, messages: null }),
        sample("2026-11-13T11:00:00Z", { costUsd: 0.2, messages: null }),
      ],
      NOW,
    );
    expect(rows[0]).toMatchObject({
      conversations: 2,
      costAvgUsd: 0.2,
      costUnknown: 1,
      messagesAvg: null,
      messagesMax: null,
    });
  });

  it("el día se corta en la zona pedida", () => {
    const late = sample("2026-11-13T01:00:00Z");
    const utc = aggregateAssistantDays([late], NOW, { days: 2 });
    expect(utc[0]?.conversations).toBe(1);
    const ar = aggregateAssistantDays([late], NOW, { days: 2, offsetMinutes: -180 });
    expect(ar[0]?.day).toBe("2026-11-13");
    expect(ar[0]?.conversations).toBe(0);
    expect(ar[1]?.conversations).toBe(1);
  });
});
