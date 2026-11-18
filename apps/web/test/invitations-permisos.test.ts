import { describe, expect, it, vi } from "vitest";
import { isPrivilegedEmail, mayRegisterWithInvitation } from "../lib/invitations-core";

const ENV = {
  ADMIN_EMAILS: "admin-lista@example.com",
  ASSISTANT_TESTER_EMAILS: "tester-lista@example.com, otra-tester@example.com",
};

describe("isPrivilegedEmail", () => {
  it("reconoce las dos listas, sin importar mayúsculas ni espacios", () => {
    expect(isPrivilegedEmail("admin-lista@example.com", ENV)).toBe(true);
    expect(isPrivilegedEmail("  Tester-Lista@Example.com ", ENV)).toBe(true);
    expect(isPrivilegedEmail("otra-tester@example.com", ENV)).toBe(true);
  });

  it("un email fuera de las listas, o sin listas cargadas, no tiene permisos", () => {
    expect(isPrivilegedEmail("persona@example.com", ENV)).toBe(false);
    expect(isPrivilegedEmail("admin-lista@example.com", {})).toBe(false);
  });
});

describe("mayRegisterWithInvitation", () => {
  it("un email de las listas con invitación genérica no se registra", async () => {
    const isBound = vi.fn(async () => false);
    await expect(mayRegisterWithInvitation("tester-lista@example.com", ENV, isBound)).resolves.toBe(
      false,
    );
    expect(isBound).toHaveBeenCalledTimes(1);
  });

  it("un email de las listas con invitación atada a ese email se registra", async () => {
    await expect(
      mayRegisterWithInvitation("admin-lista@example.com", ENV, async () => true),
    ).resolves.toBe(true);
  });

  it("si la consulta falla, el registro no sigue", async () => {
    await expect(
      mayRegisterWithInvitation("admin-lista@example.com", ENV, async () => {
        throw new Error("sin base");
      }),
    ).rejects.toThrow("sin base");
  });

  it("un email común se registra sin consultar la invitación", async () => {
    const isBound = vi.fn(async () => false);
    await expect(mayRegisterWithInvitation("persona@example.com", ENV, isBound)).resolves.toBe(
      true,
    );
    expect(isBound).not.toHaveBeenCalled();
  });
});
