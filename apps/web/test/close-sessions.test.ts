import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  order: [] as string[],
  sets: [] as Record<string, unknown>[],
  userId: "",
}));

vi.mock("@job-search-os/adapters", () => ({
  markAllResetTokensUsed: vi.fn(async () => {
    calls.order.push("reset");
  }),
}));

vi.mock("../lib/db", () => ({
  withUser: async (userId: string, run: (tx: unknown) => unknown) => {
    calls.userId = userId;
    return run({
      update: () => ({
        set: (values: Record<string, unknown>) => {
          calls.sets.push(values);
          calls.order.push(Object.keys(values).includes("sessionVersion") ? "sesion" : "mcp");
          return { where: async () => [] };
        },
      }),
    });
  },
}));

import { closeAllSessions } from "../lib/close-sessions";

describe("closeAllSessions", () => {
  it("sube la versión, revoca los tokens MCP y vence los links de reset, todo con su propia sesión", async () => {
    await closeAllSessions("a2400000-0000-4000-8000-000000000001");

    expect(calls.userId).toBe("a2400000-0000-4000-8000-000000000001");
    expect(calls.order).toEqual(["sesion", "mcp", "reset"]);
    expect(Object.keys(calls.sets[0]!).sort()).toEqual(["sessionVersion", "updatedAt"]);
    expect(Object.keys(calls.sets[1]!)).toEqual(["revokedAt"]);
  });
});
