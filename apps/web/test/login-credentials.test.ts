import { describe, expect, it, vi } from "vitest";
import { authorizeCredentials, loginEmailHash, type LoginDeps } from "../lib/login-credentials";

/** Dependencias en memoria: por defecto el intento se permite y la contraseña es correcta. */
function deps(overrides: Partial<LoginDeps> = {}) {
  return {
    beginAttempt: vi.fn<LoginDeps["beginAttempt"]>().mockResolvedValue(true),
    clearAttempts: vi.fn<LoginDeps["clearAttempts"]>().mockResolvedValue(undefined),
    findUser: vi
      .fn<LoginDeps["findUser"]>()
      .mockResolvedValue({ id: "persona-1", password_hash: "hash-guardado" }),
    verifyPassword: vi.fn<LoginDeps["verifyPassword"]>().mockResolvedValue(true),
    sessionVersion: vi.fn<LoginDeps["sessionVersion"]>().mockResolvedValue(3),
    ...overrides,
  };
}

const CREDENTIALS = { email: "  Persona@Example.com ", password: "clave-de-prueba" };
const HASH = loginEmailHash("persona@example.com");

describe("authorizeCredentials", () => {
  it("con el intento bloqueado rechaza la clave correcta sin buscar la cuenta ni gastar scrypt", async () => {
    const d = deps({ beginAttempt: vi.fn<LoginDeps["beginAttempt"]>().mockResolvedValue(false) });

    await expect(authorizeCredentials(d, CREDENTIALS)).resolves.toBeNull();

    expect(d.beginAttempt).toHaveBeenCalledWith(HASH);
    expect(d.findUser).not.toHaveBeenCalled();
    expect(d.verifyPassword).not.toHaveBeenCalled();
    expect(d.clearAttempts).not.toHaveBeenCalled();
  });

  it("con la clave correcta limpia los intentos y devuelve la sesión", async () => {
    const d = deps();

    await expect(authorizeCredentials(d, CREDENTIALS)).resolves.toEqual({
      id: "persona-1",
      email: "persona@example.com",
      sessionVersion: 3,
    });

    expect(d.clearAttempts).toHaveBeenCalledWith(HASH);
  });

  it("con la clave incorrecta no limpia los intentos", async () => {
    const d = deps({
      verifyPassword: vi.fn<LoginDeps["verifyPassword"]>().mockResolvedValue(false),
    });

    await expect(authorizeCredentials(d, CREDENTIALS)).resolves.toBeNull();

    expect(d.clearAttempts).not.toHaveBeenCalled();
  });

  it("con un email inexistente verifica igual contra el hash de relleno y cuenta el intento", async () => {
    const verifyPassword = vi.fn<LoginDeps["verifyPassword"]>().mockResolvedValue(false);
    const d = deps({
      findUser: vi.fn<LoginDeps["findUser"]>().mockResolvedValue(undefined),
      verifyPassword,
    });

    await expect(authorizeCredentials(d, CREDENTIALS)).resolves.toBeNull();

    expect(d.beginAttempt).toHaveBeenCalledWith(HASH);
    expect(verifyPassword).toHaveBeenCalledTimes(1);
    expect(verifyPassword.mock.calls[0]?.[1]).toMatch(/^scrypt\$0+\$0+$/);
    expect(d.clearAttempts).not.toHaveBeenCalled();
  });

  it("sin email o sin contraseña no cuenta un intento", async () => {
    const d = deps();

    await expect(authorizeCredentials(d, { email: " ", password: "x" })).resolves.toBeNull();
    await expect(
      authorizeCredentials(d, { email: "a@example.com", password: "" }),
    ).resolves.toBeNull();
    await expect(authorizeCredentials(d, undefined)).resolves.toBeNull();

    expect(d.beginAttempt).not.toHaveBeenCalled();
  });
});

describe("loginEmailHash", () => {
  it("devuelve sha256 en hexadecimal, sin el email en claro", () => {
    expect(HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(HASH).not.toContain("persona");
  });
});
