import { describe, expect, it } from "vitest";
// apps/web no tiene runner propio: la parte pura de las invitaciones se prueba desde acá.
import {
  generateInvitationCode,
  hashInvitationCode,
  invitationStatus,
  isInvitationAdmin,
  isValidEmail,
  validateRegistration,
} from "../../../apps/web/lib/invitations-core";

describe("invitations-core (JS-091)", () => {
  it("el código tiene 32 bytes en base64url y el hash es su sha256, nunca el código", () => {
    const { code, codeHash } = generateInvitationCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(codeHash).not.toContain(code);
    expect(hashInvitationCode(code)).toBe(codeHash);
  });

  it("dos códigos nunca coinciden", () => {
    expect(generateInvitationCode().code).not.toBe(generateInvitationCode().code);
  });

  it("valida email", () => {
    expect(isValidEmail("  Persona@Ejemplo.TEST ")).toBe(true);
    expect(isValidEmail("sin-arroba")).toBe(false);
    expect(isValidEmail("a b@c.d")).toBe(false);
  });

  it("valida el registro: código, email y contraseña de 8+", () => {
    const base = { code: "x", email: "a@b.test", password: "12345678" };
    expect(validateRegistration(base)).toEqual({ ok: true });
    expect(validateRegistration({ ...base, code: "" })).toEqual({ ok: false, reason: "code" });
    expect(validateRegistration({ ...base, email: "no" })).toEqual({ ok: false, reason: "email" });
    expect(validateRegistration({ ...base, password: "1234567" })).toEqual({
      ok: false,
      reason: "password",
    });
    expect(validateRegistration({ ...base, password: "x".repeat(129) })).toEqual({
      ok: false,
      reason: "password",
    });
    expect(validateRegistration({ ...base, password: "x".repeat(128) })).toEqual({ ok: true });
  });

  it("topes de largo en servidor: código 64, nombre 100", () => {
    const base = { code: "x", email: "a@b.test", password: "12345678" };
    expect(validateRegistration({ ...base, code: "c".repeat(65) })).toEqual({
      ok: false,
      reason: "code",
    });
    expect(validateRegistration({ ...base, name: "n".repeat(101) })).toEqual({
      ok: false,
      reason: "name",
    });
    expect(validateRegistration({ ...base, name: "n".repeat(100) })).toEqual({ ok: true });
  });

  it("ADMIN_EMAILS: lista normalizada; vacía o sin definir, nadie", () => {
    expect(isInvitationAdmin("Admin@Ejemplo.test", " otro@x.test, admin@ejemplo.test ")).toBe(true);
    expect(isInvitationAdmin("admin@ejemplo.test", "")).toBe(false);
    expect(isInvitationAdmin("admin@ejemplo.test", undefined)).toBe(false);
    expect(isInvitationAdmin("admin@ejemplo.test", ",,")).toBe(false);
    expect(isInvitationAdmin(null, "admin@ejemplo.test")).toBe(false);
    expect(isInvitationAdmin("ejemplo.test", "admin@ejemplo.test")).toBe(false);
  });

  it("estado: pendiente, usada o vencida (usada gana)", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const future = new Date("2026-10-20T00:00:00Z");
    const past = new Date("2026-10-01T00:00:00Z");
    expect(invitationStatus({ usedAt: null, expiresAt: future }, now)).toBe("pendiente");
    expect(invitationStatus({ usedAt: null, expiresAt: past }, now)).toBe("vencida");
    expect(invitationStatus({ usedAt: past, expiresAt: past }, now)).toBe("usada");
  });
});
