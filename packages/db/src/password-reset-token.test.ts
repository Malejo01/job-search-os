import { describe, expect, it } from "vitest";
import { RESET_TOKEN_TTL_MS, generateResetToken, hashResetToken } from "./password-reset-token";

describe("generateResetToken", () => {
  it("genera un token de 64 caracteres hex y su hash correspondiente", () => {
    const { token, tokenHash } = generateResetToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(hashResetToken(token));
  });

  it("no repite tokens entre llamadas", () => {
    const a = generateResetToken();
    const b = generateResetToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it("vence una hora después del momento dado", () => {
    const now = new Date("2026-09-16T12:00:00Z");
    const { expiresAt } = generateResetToken(now);
    expect(expiresAt.getTime() - now.getTime()).toBe(RESET_TOKEN_TTL_MS);
  });
});

describe("hashResetToken", () => {
  it("es determinístico", () => {
    expect(hashResetToken("abc")).toBe(hashResetToken("abc"));
  });

  it("distingue tokens distintos", () => {
    expect(hashResetToken("abc")).not.toBe(hashResetToken("abd"));
  });
});
