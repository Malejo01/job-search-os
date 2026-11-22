import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gte: [] as unknown[][],
}));

vi.mock("@job-search-os/db", () => ({
  schema: {
    inboundEmails: {
      id: "id",
      fromAddress: "from_address",
      receivedAt: "received_at",
      parser: "parser",
    },
    inboundSenderDomains: { verdict: "verdict", userId: "user_id", domain: "domain" },
  },
  inboxWhere: { pendientes: "p", vistos: "v", descartados: "d" },
  inboxAttention: {},
}));
vi.mock("@job-search-os/adapters", () => ({ pgBlobStorage: () => ({}) }));
vi.mock("drizzle-orm", () => {
  const sql = Object.assign((..._a: unknown[]) => ({}), { raw: () => ({}) });
  return {
    sql,
    and: vi.fn(),
    eq: vi.fn(),
    desc: vi.fn(),
    inArray: vi.fn(),
    isNull: vi.fn(),
    not: vi.fn(),
    gte: (...args: unknown[]) => {
      mocks.gte.push(args);
      return {};
    },
  };
});
// Cadena de consulta que no devuelve filas: solo interesa qué condiciones se arman
vi.mock("../lib/db", () => {
  const chain = (): unknown =>
    new Proxy(function () {}, {
      get: (_t, key) => {
        if (key === "then") return (resolve: (v: unknown[]) => void) => resolve([]);
        return () => chain();
      },
    });
  return { withUser: async (_u: string, fn: (tx: unknown) => unknown) => fn({ select: chain }) };
});

import { filterLeaks } from "../lib/filter-leak";
import { listInbox } from "../lib/inbox-list";

const NOW = new Date("2026-11-22T12:00:00Z");
const THIRTY_DAYS_AGO = new Date("2026-10-23T12:00:00Z").getTime();

const windowCalls = () =>
  mocks.gte
    .filter(([column]) => column === "received_at")
    .map(([, value]) => new Date(value as Date).getTime());

describe("/inbox agrega solo sobre una ventana de 30 días", () => {
  beforeEach(() => {
    mocks.gte.length = 0;
  });

  it("los conteos de las pestañas filtran por received_at de los últimos 30 días", async () => {
    await listInbox("u1", "pendientes", undefined, NOW);
    expect(windowCalls()).toContain(THIRTY_DAYS_AGO);
  });

  it("el aviso de fuga del filtro agrupa solo los últimos 30 días", async () => {
    await filterLeaks("u1", NOW);
    expect(windowCalls()).toContain(THIRTY_DAYS_AGO);
  });
});
