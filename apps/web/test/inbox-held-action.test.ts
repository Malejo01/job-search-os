import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as { id: string }[],
  processHeldInbound: vi.fn(),
  close: vi.fn(async () => undefined),
  redirect: vi.fn(),
  userId: "a0000000-0000-4000-8000-000000000001",
}));

vi.mock("@job-search-os/db", () => ({
  createDb: () => ({ db: {}, close: mocks.close }),
  requireDatabaseUrl: () => "postgres://prueba",
  schema: { inboundEmails: { id: "id", error: "error" } },
}));
vi.mock("@job-search-os/adapters", () => ({
  AUTH_UNVERIFIED_REASON: "no verificado",
  createLogger: () => ({}),
  pgBlobStorage: () => ({}),
  processHeldInbound: mocks.processHeldInbound,
}));
vi.mock("drizzle-orm", () => ({ and: vi.fn(), eq: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("../lib/session", () => ({ requireActiveUserId: async () => mocks.userId }));
// El rol de la app con RLS: solo devuelve filas de la persona de la sesión
vi.mock("../lib/db", () => ({
  withUser: async (_userId: string, fn: (tx: unknown) => unknown) =>
    fn({ select: () => ({ from: () => ({ where: () => ({ limit: async () => mocks.rows }) }) }) }),
}));

import { processHeldAction } from "../app/(app)/inbox/held-actions";

const ID = "b0000000-0000-4000-8000-000000000002";
const form = (id: string) => {
  const f = new FormData();
  f.set("id", id);
  return f;
};

describe("processHeldAction", () => {
  beforeEach(() => {
    mocks.rows = [];
    mocks.processHeldInbound.mockReset();
    mocks.redirect.mockReset();
    mocks.processHeldInbound.mockResolvedValue({ ok: true, inboundId: "nuevo" });
  });

  it("procesa el email retenido de su dueña con el usuario de la sesión", async () => {
    mocks.rows = [{ id: ID }];
    await processHeldAction(form(ID));
    expect(mocks.processHeldInbound).toHaveBeenCalledTimes(1);
    expect(mocks.processHeldInbound.mock.calls[0]!.slice(0, 2)).toEqual([ID, mocks.userId]);
    expect(mocks.redirect).toHaveBeenCalledWith("/inbox/nuevo");
    expect(mocks.close).toHaveBeenCalled();
  });

  it("no procesa el email de otra persona (RLS no devuelve la fila)", async () => {
    mocks.rows = [];
    await processHeldAction(form(ID));
    expect(mocks.processHeldInbound).not.toHaveBeenCalled();
  });

  it("un id que no es un UUID no consulta ni procesa nada", async () => {
    mocks.rows = [{ id: ID }];
    await processHeldAction(form("no-es-uuid"));
    expect(mocks.processHeldInbound).not.toHaveBeenCalled();
  });

  it("si no se pudo procesar vuelve al detalle del mismo email", async () => {
    mocks.rows = [{ id: ID }];
    mocks.processHeldInbound.mockResolvedValue({ ok: false, reason: "cupo" });
    await processHeldAction(form(ID));
    expect(mocks.redirect).toHaveBeenCalledWith(`/inbox/${ID}`);
  });
});
