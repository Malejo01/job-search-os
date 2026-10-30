import { describe, expect, it } from "vitest";
import type { CvHistoryInput } from "../cv-out/model";
import { applyChatMerge, mergeChatHistory, type CvStoredEntry } from "./merge";
import { initialCvChatState } from "./state";
import { CV_CHAT_STATE_SCHEMA, parseCvChatState } from "./state-schema";

const job = (org: string, title: string, start: string | null, bullets: string[] = []) =>
  ({
    kind: "trabajo",
    organization: org,
    title,
    startMonth: start,
    endMonth: null,
    bullets,
  }) satisfies CvHistoryInput;

describe("mergeChatHistory", () => {
  const existing: CvStoredEntry[] = [
    { id: "r1", ...job("Empresa A", "Analista", "2021-03", ["viejo"]) },
  ];

  it("actualiza la que coincide (sin mirar mayúsculas ni acentos) y suma la nueva", () => {
    const m = mergeChatHistory(existing, [
      job("empresa a", "ANALISTA", "2021-03", ["nuevo"]),
      job("Empresa B", "Asistente", null),
    ]);
    expect(m.updates).toEqual([
      { id: "r1", entry: job("empresa a", "ANALISTA", "2021-03", ["nuevo"]) },
    ]);
    expect(m.inserts).toEqual([job("Empresa B", "Asistente", null)]);
    expect(applyChatMerge(existing, m).map((e) => e.organization)).toEqual([
      "empresa a",
      "Empresa B",
    ]);
  });

  it("respeta el tope de 20 entradas", () => {
    const full: CvStoredEntry[] = Array.from({ length: 20 }, (_, i) => ({
      id: `r${i}`,
      ...job(`Empresa ${i}`, "Cargo", null),
    }));
    const m = mergeChatHistory(full, [job("Empresa X", "Cargo", null)]);
    expect(m.inserts).toEqual([]);
    expect(m.overflow).toBe(1);
  });

  it("no repite entradas iguales del mismo chat", () => {
    const m = mergeChatHistory([], [job("A", "B", null), job("a", "b", null)]);
    expect(m.inserts).toHaveLength(1);
  });
});

describe("parseCvChatState", () => {
  it("acepta el estado inicial", () => {
    expect(parseCvChatState(initialCvChatState())).toEqual(initialCvChatState());
  });

  it("rechaza campos de más, topes y tipos", () => {
    const base = initialCvChatState();
    expect(parseCvChatState({ ...base, extra: 1 })).toBeNull();
    expect(parseCvChatState({ ...base, turns: 99 })).toBeNull();
    expect(parseCvChatState({ ...base, skills: Array.from({ length: 41 }, () => "x") })).toBeNull();
    expect(parseCvChatState({ ...base, target: "x".repeat(500) })).toBeNull();
    expect(parseCvChatState({ ...base, links: { github: "javascript:alert(1)" } })).toBeNull();
    expect(parseCvChatState(null)).toBeNull();
    expect(CV_CHAT_STATE_SCHEMA.safeParse("x").success).toBe(false);
  });
});
