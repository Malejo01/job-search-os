import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const executed: unknown[] = [];

/** Transacción de mentira: registra el orden de las escrituras y devuelve el email de la cuenta. */
const tx = {
  select: () => ({
    from: () => ({ where: () => ({ limit: async () => [{ email: " Persona@Example.com " }] }) }),
  }),
  update: () => {
    calls.push("update");
    return { set: () => ({ where: async () => undefined }) };
  },
  execute: async (query: unknown) => {
    calls.push("clear");
    executed.push(query);
  },
};

let tokenOwner = "persona-1";

vi.mock("@job-search-os/adapters", () => ({
  consumeResetToken: vi.fn(async () => tokenOwner),
  createLogger: () => ({ info: vi.fn(), error: vi.fn() }),
  markAllResetTokensUsed: vi.fn(async () => {
    calls.push("tokens");
  }),
  resetUrlBase: vi.fn(),
  safeDbError: vi.fn(),
  sendEmail: vi.fn(),
}));
vi.mock("@job-search-os/db/password", () => ({ hashPassword: () => "hash-nuevo" }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../lib/db", () => ({
  getAppDb: () => ({
    execute: async () => [
      { user_id: "persona-1", expires_at: new Date(Date.now() + 60_000), used_at: null },
    ],
  }),
  withUser: async (_userId: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
}));

import { loginEmailHash } from "../lib/login-credentials";
import { resetPassword } from "../lib/password-reset";

/** Aplana el SQL de drizzle: el texto y los parámetros que lleva. */
function flatten(query: unknown): string {
  const chunks = (query as { queryChunks: unknown[] }).queryChunks;
  return chunks
    .map((c) => (typeof c === "string" ? c : ((c as { value?: unknown }).value ?? String(c))))
    .flat()
    .join("");
}

describe("resetPassword", () => {
  beforeEach(() => {
    calls.length = 0;
    executed.length = 0;
    tokenOwner = "persona-1";
  });

  it("limpia los intentos de login de ese email dentro de la misma transacción", async () => {
    const result = await resetPassword("token-de-prueba", "clave-nueva-123");

    expect(result.ok).toBe(true);
    expect(calls).toContain("clear");
    expect(calls.indexOf("clear")).toBeGreaterThan(calls.indexOf("tokens"));
    const sentence = flatten(executed[0]);
    expect(sentence).toContain("login_attempt_clear");
    expect(sentence).toContain(loginEmailHash("persona@example.com"));
    expect(sentence).not.toContain("example.com");
  });

  it("si otro pedido ganó el token no se toca el contador", async () => {
    tokenOwner = "otra-persona";

    const result = await resetPassword("token-de-prueba", "clave-nueva-123");

    expect(result).toEqual({ ok: false, reason: "used" });
    expect(calls).not.toContain("clear");
  });
});
