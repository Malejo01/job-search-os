import { describe, expect, it, vi } from "vitest";
import {
  authorizeCredentials,
  createVerificationPacer,
  loginEmailHash,
  type LoginDeps,
} from "../lib/login-credentials";

/** Dependencias en memoria: por defecto el intento se permite y la contraseña es correcta. */
function deps(overrides: Partial<LoginDeps> = {}) {
  return {
    beginAttempt: vi.fn<LoginDeps["beginAttempt"]>().mockResolvedValue(true),
    clearAttempts: vi.fn<LoginDeps["clearAttempts"]>().mockResolvedValue(undefined),
    findUser: vi
      .fn<LoginDeps["findUser"]>()
      .mockResolvedValue({ id: "persona-1", password_hash: "hash-guardado" }),
    verifyPassword: vi.fn<LoginDeps["verifyPassword"]>().mockResolvedValue(true),
    waitLikeVerification: vi.fn<LoginDeps["waitLikeVerification"]>().mockResolvedValue(undefined),
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
    expect(d.waitLikeVerification).toHaveBeenCalledTimes(1);
  });

  it("un intento permitido no agrega la espera", async () => {
    const d = deps();

    await authorizeCredentials(d, CREDENTIALS);

    expect(d.waitLikeVerification).not.toHaveBeenCalled();
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

describe("createVerificationPacer", () => {
  function pacer(verifyMs: number) {
    let clock = 0;
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    const paced = createVerificationPacer(
      async () => {
        clock += verifyMs;
        return false;
      },
      { now: () => clock, sleep },
    );
    return { paced, sleep };
  }

  it("espera lo que tardó la última verificación", async () => {
    const { paced, sleep } = pacer(140);

    await paced.verifyPassword("clave", "hash");
    await paced.waitLikeVerification();

    expect(sleep).toHaveBeenCalledWith(140);
  });

  it("antes de la primera verificación usa un valor por defecto", async () => {
    const { paced, sleep } = pacer(140);

    await paced.waitLikeVerification();

    expect(sleep).toHaveBeenCalledWith(100);
  });

  it("no espera más de 2 segundos aunque una verificación haya tardado más", async () => {
    const { paced, sleep } = pacer(30_000);

    await paced.verifyPassword("clave", "hash");
    await paced.waitLikeVerification();

    expect(sleep).toHaveBeenCalledWith(2_000);
  });
});

describe("loginEmailHash", () => {
  it("devuelve sha256 en hexadecimal, sin el email en claro", () => {
    expect(HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(HASH).not.toContain("persona");
  });
});
