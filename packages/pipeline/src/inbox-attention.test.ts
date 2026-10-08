import { describe, expect, it } from "vitest";
import { needsAttention, type AttentionRow } from "./inbox-attention";

const base: AttentionRow = {
  parser: "linkedin",
  jobsExtracted: 3,
  error: null,
  seenAt: null,
  dismissedAt: null,
};

describe("necesita intervención (ronda 19)", () => {
  it("un email con avisos extraídos y sin error no es pendiente, aunque no esté visto", () => {
    expect(needsAttention(base)).toBe(false);
  });

  it("con error (cola manual) es pendiente", () => {
    expect(needsAttention({ ...base, jobsExtracted: 0, error: "estructura no reconocida" })).toBe(
      true,
    );
    expect(needsAttention({ ...base, error: "remitente no esperado" })).toBe(true);
  });

  it("sin parser es pendiente", () => {
    expect(needsAttention({ ...base, parser: "none", jobsExtracted: 0 })).toBe(true);
    expect(needsAttention({ ...base, parser: null, jobsExtracted: null })).toBe(true);
  });

  it("la confirmación de reenvío de Gmail es pendiente", () => {
    expect(needsAttention({ ...base, parser: "gmail_reenvio", jobsExtracted: 0 })).toBe(true);
  });

  it("visto o descartado nunca es pendiente", () => {
    const sin = { ...base, parser: "none", error: "cola manual" };
    expect(needsAttention({ ...sin, seenAt: new Date("2026-10-01T10:00:00Z") })).toBe(false);
    expect(needsAttention({ ...sin, dismissedAt: new Date("2026-10-01T10:00:00Z") })).toBe(false);
    expect(
      needsAttention({
        ...base,
        parser: "gmail_reenvio",
        seenAt: new Date("2026-10-01T10:00:00Z"),
      }),
    ).toBe(false);
  });
});
