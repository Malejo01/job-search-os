import { describe, expect, it, vi } from "vitest";
import {
  authorizeCredentials,
  createVerificationPacer,
  loginClientIp,
  loginEmailHash,
  loginEmailHashes,
  loginIpHash,
  loginSecretMissingInProduction,
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

    expect(d.beginAttempt).toHaveBeenCalledWith(HASH, null);
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

    expect(d.beginAttempt).toHaveBeenCalledWith(HASH, null);
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

describe("intentos por IP", () => {
  it("pasa el hash de la IP al contador, nunca la IP en claro", async () => {
    const beginAttempt = vi.fn<LoginDeps["beginAttempt"]>().mockResolvedValue(true);
    const d = deps({ beginAttempt });

    await authorizeCredentials(d, CREDENTIALS, "203.0.113.7");

    const ipHash = loginIpHash("203.0.113.7");
    expect(ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(beginAttempt).toHaveBeenCalledWith(HASH, ipHash);
    expect(JSON.stringify(beginAttempt.mock.calls)).not.toContain("203.0.113.7");
  });

  it("con secreto el hash de la IP es un HMAC: no se recorre el espacio IPv4 sin el secreto", () => {
    const plain = loginIpHash("203.0.113.7", "");
    const keyed = loginIpHash("203.0.113.7", "secreto-de-prueba");
    expect(keyed).toMatch(/^[0-9a-f]{64}$/);
    expect(keyed).not.toBe(plain);
    expect(keyed).toBe(loginIpHash("203.0.113.7", "secreto-de-prueba"));
    expect(keyed).not.toBe(loginIpHash("203.0.113.7", "otro-secreto"));
    expect(loginIpHash(null, "secreto-de-prueba")).toBeNull();
  });

  it("IP distintas dan claves distintas y sin IP no hay clave", () => {
    expect(loginIpHash("203.0.113.7")).not.toBe(loginIpHash("203.0.113.8"));
    expect(loginIpHash(null)).toBeNull();
  });
});

describe("loginSecretMissingInProduction (aviso de /admin/salud)", () => {
  it("avisa solo en producción y solo si falta el secreto (vacío cuenta como falta)", () => {
    expect(loginSecretMissingInProduction({ VERCEL_ENV: "production" })).toBe(true);
    expect(
      loginSecretMissingInProduction({ VERCEL_ENV: "production", LOGIN_ATTEMPTS_HMAC_SECRET: " " }),
    ).toBe(true);
    expect(
      loginSecretMissingInProduction({ VERCEL_ENV: "production", LOGIN_ATTEMPTS_HMAC_SECRET: "x" }),
    ).toBe(false);
    expect(loginSecretMissingInProduction({ VERCEL_ENV: "preview" })).toBe(false);
    expect(loginSecretMissingInProduction({})).toBe(false);
  });
});

describe("loginClientIp", () => {
  const req = (headers: Record<string, string>) => ({
    headers: { get: (name: string) => headers[name] ?? null },
  });

  it("toma la primera dirección de x-forwarded-for", () => {
    expect(loginClientIp(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });

  it("usa x-real-ip si falta x-forwarded-for", () => {
    expect(loginClientIp(req({ "x-real-ip": "2001:db8::1" }))).toBe("2001:db8::1");
  });

  it("sin cabeceras, con basura o demasiado largo devuelve null", () => {
    expect(loginClientIp(undefined)).toBeNull();
    expect(loginClientIp(req({}))).toBeNull();
    expect(loginClientIp(req({ "x-forwarded-for": "no es una ip" }))).toBeNull();
    expect(loginClientIp(req({ "x-forwarded-for": "1".repeat(200) }))).toBeNull();
  });
});

describe("formato del email", () => {
  it.each([
    "no-es-un-email",
    "dos@@example.com",
    "con espacio@example.com",
    "@example.com",
    "persona@",
    `${"a".repeat(250)}@example.com`,
  ])(
    "un email inválido (%#) responde igual que una clave incorrecta y no reserva intento",
    async (email) => {
      const d = deps();

      await expect(authorizeCredentials(d, { email, password: "clave" })).resolves.toBeNull();

      expect(d.beginAttempt).not.toHaveBeenCalled();
      expect(d.findUser).not.toHaveBeenCalled();
      expect(d.waitLikeVerification).toHaveBeenCalledTimes(1);
    },
  );

  it("un email válido sigue su camino", async () => {
    const d = deps();

    await authorizeCredentials(d, { email: "persona+etiqueta@sub.example.com", password: "clave" });

    expect(d.beginAttempt).toHaveBeenCalledTimes(1);
  });
});

describe("hash con secreto", () => {
  it("con secreto el hash es un HMAC distinto del sha256 simple", () => {
    const plain = loginEmailHash("persona@example.com");
    const keyed = loginEmailHash("persona@example.com", "secreto-de-prueba");

    expect(keyed).toMatch(/^[0-9a-f]{64}$/);
    expect(keyed).not.toBe(plain);
    expect(loginEmailHash("persona@example.com", "otro-secreto")).not.toBe(keyed);
    expect(loginEmailHash("otra@example.com", "secreto-de-prueba")).not.toBe(keyed);
  });

  it("sin secreto (o vacío) sigue siendo el sha256 de siempre", () => {
    expect(loginEmailHash("persona@example.com", "")).toBe(HASH);
    expect(loginEmailHash("persona@example.com", undefined)).toBe(HASH);
  });

  it("toma el secreto de LOGIN_ATTEMPTS_HMAC_SECRET", async () => {
    vi.stubEnv("LOGIN_ATTEMPTS_HMAC_SECRET", "secreto-de-prueba");
    try {
      const beginAttempt = vi.fn<LoginDeps["beginAttempt"]>().mockResolvedValue(true);

      await authorizeCredentials(deps({ beginAttempt }), CREDENTIALS);

      expect(beginAttempt.mock.calls[0]?.[0]).toBe(
        loginEmailHash("persona@example.com", "secreto-de-prueba"),
      );
      expect(beginAttempt.mock.calls[0]?.[0]).not.toBe(HASH);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("loginEmailHashes lista el hash vigente y el anterior, para limpiar los dos", () => {
    vi.stubEnv("LOGIN_ATTEMPTS_HMAC_SECRET", "secreto-de-prueba");
    try {
      expect(loginEmailHashes("persona@example.com")).toEqual([
        loginEmailHash("persona@example.com", "secreto-de-prueba"),
        HASH,
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(loginEmailHashes("persona@example.com")).toEqual([HASH]);
  });
});

describe("loginEmailHash", () => {
  it("devuelve sha256 en hexadecimal, sin el email en claro", () => {
    expect(HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(HASH).not.toContain("persona");
  });
});
