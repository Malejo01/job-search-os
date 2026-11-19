import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, queries: 0 }));

vi.mock("@job-search-os/db", () => ({
  schema: {
    profiles: {
      userId: "user_id",
      inboundAddress: "inbound_address",
      previousInboundUntil: "until",
    },
  },
}));
vi.mock("@job-search-os/adapters", () => ({ createLogger: () => ({}) }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("../lib/db", () => ({
  withUser: async (_userId: string, fn: (tx: unknown) => unknown) =>
    fn({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              mocks.queries += 1;
              return mocks.row ? [mocks.row] : [];
            },
          }),
        }),
      }),
    }),
}));

import { getInboundAddressState } from "../lib/inbound-address";

const NOW = new Date("2026-11-19T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe("getInboundAddressState · aviso de la rotación", () => {
  beforeEach(() => {
    mocks.row = null;
    mocks.queries = 0;
  });

  it("dentro de la gracia devuelve la dirección nueva y el vencimiento", async () => {
    mocks.row = { address: "u_nueva@ingest.example", previousUntil: day(5) };
    expect(await getInboundAddressState("u1", NOW)).toEqual({
      address: "u_nueva@ingest.example",
      graceUntil: day(5),
    });
  });

  it("vencida la gracia no hay aviso", async () => {
    mocks.row = { address: "u_nueva@ingest.example", previousUntil: day(-1) };
    expect((await getInboundAddressState("u1", NOW))?.graceUntil).toBeNull();
  });

  it("sin rotación no hay aviso", async () => {
    mocks.row = { address: "u_nueva@ingest.example", previousUntil: null };
    expect((await getInboundAddressState("u1", NOW))?.graceUntil).toBeNull();
  });

  it("sin perfil devuelve null", async () => {
    expect(await getInboundAddressState("u1", NOW)).toBeNull();
  });

  it("es una sola consulta", async () => {
    mocks.row = { address: "u_nueva@ingest.example", previousUntil: day(5) };
    await getInboundAddressState("u1", NOW);
    expect(mocks.queries).toBe(1);
  });
});
