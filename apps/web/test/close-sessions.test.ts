import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  set: vi.fn(),
  where: vi.fn(async () => []),
  userId: "",
}));

vi.mock("../lib/db", () => ({
  withUser: async (userId: string, run: (tx: unknown) => unknown) => {
    calls.userId = userId;
    return run({
      update: () => ({
        set: (values: unknown) => {
          calls.set(values);
          return { where: calls.where };
        },
      }),
    });
  },
}));

import { closeAllSessions } from "../lib/close-sessions";

describe("closeAllSessions", () => {
  it("sube la versión de sesión de la cuenta con su propia sesión", async () => {
    await closeAllSessions("a2400000-0000-4000-8000-000000000001");

    expect(calls.userId).toBe("a2400000-0000-4000-8000-000000000001");
    expect(calls.where).toHaveBeenCalledTimes(1);
    const values = calls.set.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(values).sort()).toEqual(["sessionVersion", "updatedAt"]);
  });
});
