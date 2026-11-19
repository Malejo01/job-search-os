import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  hashCalls: 0,
  redeemable: true,
  bound: false,
  registeredUserId: null as string | null,
}));

vi.mock("@job-search-os/adapters", () => ({ resetUrlBase: vi.fn() }));
vi.mock("@job-search-os/db/password", () => ({
  hashPassword: () => {
    state.hashCalls += 1;
    return "hash-de-prueba";
  },
}));
vi.mock("../lib/db", () => ({
  withUser: vi.fn(),
  getAppDb: () => ({
    // El SQL de drizzle se reconoce por el nombre de la función que llama.
    execute: async (query: { queryChunks: unknown[] }) => {
      const text = query.queryChunks
        .map((c) => (typeof c === "string" ? c : ((c as { value?: unknown }).value ?? "")))
        .flat()
        .join("");
      if (text.includes("invitation_is_redeemable")) return [{ ok: state.redeemable }];
      if (text.includes("invitation_is_bound_to_email")) return [{ ok: state.bound }];
      return [{ user_id: state.registeredUserId }];
    },
  }),
}));

import { InvalidInvitationError, registerWithInvitation } from "../lib/invitations";

const INPUT = {
  code: "codigo-de-prueba",
  email: "persona@example.com",
  password: "clave-de-prueba-123",
  name: "Persona",
};

describe("registerWithInvitation: el tiempo no distingue los rechazos", () => {
  beforeEach(() => {
    state.hashCalls = 0;
    state.redeemable = true;
    state.bound = false;
    state.registeredUserId = null;
    vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
    vi.stubEnv("ASSISTANT_TESTER_EMAILS", "");
  });

  it("una dirección con permisos sin invitación atada se rechaza después de calcular el hash", async () => {
    await expect(
      registerWithInvitation({ ...INPUT, email: "admin@example.com" }, "on"),
    ).rejects.toBeInstanceOf(InvalidInvitationError);

    expect(state.hashCalls).toBe(1);
  });

  it("una dirección ya registrada se rechaza también después de calcular el hash", async () => {
    await expect(registerWithInvitation(INPUT, "on")).rejects.toBeInstanceOf(
      InvalidInvitationError,
    );

    expect(state.hashCalls).toBe(1);
  });

  it("un código que no sirve sigue sin gastar el hash", async () => {
    state.redeemable = false;

    await expect(registerWithInvitation(INPUT, "on")).rejects.toBeInstanceOf(
      InvalidInvitationError,
    );

    expect(state.hashCalls).toBe(0);
  });
});
