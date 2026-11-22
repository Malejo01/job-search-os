import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userIds: [] as string[],
  queries: [] as string[],
  ok: true,
  revalidated: [] as string[],
  sessionUser: "sesion-1",
  revoked: [] as string[],
}));

vi.mock("@job-search-os/db", () => ({ schema: { profiles: {} } }));
vi.mock("@job-search-os/adapters", () => ({ createLogger: () => ({ info: () => undefined }) }));
vi.mock("@job-search-os/pipeline", () => ({}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  sql: (strings: TemplateStringsArray) => ({ text: strings.join("?") }),
}));
vi.mock("../lib/db", () => ({
  withUser: async (userId: string, fn: (tx: unknown) => unknown) => {
    mocks.userIds.push(userId);
    return fn({
      execute: async (q: { text: string }) => {
        mocks.queries.push(q.text);
        return [{ ok: mocks.ok }];
      },
    });
  },
}));

import { revokePreviousInboundAddress } from "../lib/inbound-address";

describe("revokePreviousInboundAddress", () => {
  beforeEach(() => {
    mocks.userIds.length = 0;
    mocks.queries.length = 0;
    mocks.ok = true;
  });

  it("corre la función de la base con la sesión de la persona y sin parámetros", async () => {
    expect(await revokePreviousInboundAddress("u1")).toBe(true);
    expect(mocks.userIds).toEqual(["u1"]);
    expect(mocks.queries).toHaveLength(1);
    expect(mocks.queries[0]).toContain("revoke_previous_inbound_address()");
  });

  it("devuelve false cuando no había alias que revocar", async () => {
    mocks.ok = false;
    expect(await revokePreviousInboundAddress("u1")).toBe(false);
  });
});

describe("revokeAliasAction", () => {
  beforeEach(() => {
    mocks.revalidated.length = 0;
    mocks.revoked.length = 0;
    vi.resetModules();
  });

  it("usa el usuario de la sesión, nunca uno que venga del formulario, y refresca /inbox", async () => {
    vi.doMock("next/cache", () => ({ revalidatePath: (p: string) => mocks.revalidated.push(p) }));
    vi.doMock("next/navigation", () => ({ redirect: () => undefined }));
    vi.doMock("@/lib/session", () => ({ requireActiveUserId: async () => mocks.sessionUser }));
    vi.doMock("@/lib/inbound-address", () => ({
      revokePreviousInboundAddress: async (id: string) => {
        mocks.revoked.push(id);
        return true;
      },
    }));
    vi.doMock("@/lib/inbox-list", () => ({
      bulkApply: vi.fn(),
      cleanIds: vi.fn(),
      deleteInbound: vi.fn(),
      dismissInbound: vi.fn(),
      markInboundSeen: vi.fn(),
      restoreInbound: vi.fn(),
      REVERSIBLE_BULK: [],
      undoBulk: vi.fn(),
    }));
    const { revokeAliasAction } = await import("../app/(app)/inbox/actions");

    const form = new FormData();
    form.set("userId", "otra-persona");
    await revokeAliasAction(form);

    expect(mocks.revoked).toEqual(["sesion-1"]);
    expect(mocks.revalidated).toContain("/inbox");
  });
});
