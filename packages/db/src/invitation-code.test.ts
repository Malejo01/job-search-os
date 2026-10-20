import { describe, expect, it } from "vitest";
import {
  generateInvitationCode,
  hashInvitationCode,
  INVITATION_TTL_DAYS,
  isInvitationAdmin,
  normalizeEmail,
} from "./invitation-code";

describe("invitation-code", () => {
  it("genera un código base64url de 43 caracteres y su sha256", () => {
    const a = generateInvitationCode();
    const b = generateInvitationCode();
    expect(a.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.codeHash).toBe(hashInvitationCode(a.code));
    expect(a.code).not.toBe(b.code);
  });

  it("el TTL es de 14 días", () => {
    expect(INVITATION_TTL_DAYS).toBe(14);
  });

  it("normaliza el email", () => {
    expect(normalizeEmail("  Ana@Example.COM ")).toBe("ana@example.com");
  });

  it("isInvitationAdmin compara normalizado y sin lista no deja a nadie", () => {
    expect(isInvitationAdmin("Admin@Example.com", " admin@example.com , otro@example.com")).toBe(
      true,
    );
    expect(isInvitationAdmin("x@example.com", "admin@example.com")).toBe(false);
    expect(isInvitationAdmin("admin@example.com", "")).toBe(false);
    expect(isInvitationAdmin("admin@example.com", undefined)).toBe(false);
    expect(isInvitationAdmin(null, "admin@example.com")).toBe(false);
    expect(isInvitationAdmin("", ",")).toBe(false);
  });
});
