import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  blob: null as { body: string } | null,
}));

vi.mock("@job-search-os/db", () => ({
  schema: {
    inboundEmails: { id: "id" },
    inboundSenderDomains: { verdict: "verdict", userId: "user_id", domain: "domain" },
  },
}));
vi.mock("@job-search-os/adapters", () => ({
  pgBlobStorage: () => ({ get: async () => mocks.blob }),
}));
vi.mock("drizzle-orm", () => ({ and: vi.fn(), eq: vi.fn() }));
// El rol de la app: la consulta del email y la del dominio del remitente
vi.mock("../lib/db", () => ({
  withUser: async (_userId: string, fn: (tx: unknown) => unknown) =>
    fn({
      select: () => ({
        from: () => ({
          where: () => {
            const result = Promise.resolve([]) as Promise<unknown[]> & { limit?: unknown };
            result.limit = async () => (mocks.row ? [mocks.row] : []);
            return result;
          },
        }),
      }),
    }),
}));

import { getInboundEmail } from "../lib/inbox";

const row = (rawRef: string) => ({
  id: "e1",
  fromAddress: "Aviso <aviso@portal.example>",
  subject: "Novedades",
  parser: "linkedin",
  jobsExtracted: 0,
  error: null,
  receivedAt: new Date("2026-06-01T00:00:00Z"),
  seenAt: null,
  dismissedAt: null,
  rawRef,
});

describe("getInboundEmail · contenido vencido", () => {
  beforeEach(() => {
    mocks.blob = null;
    mocks.row = null;
  });

  it("si el crudo se purgó, lo marca como vencido", async () => {
    mocks.row = row("pg:00000000-0000-4000-8000-000000000001");
    const email = await getInboundEmail("u1", "e1");
    expect(email?.expired).toBe(true);
    expect(email?.html).toBeNull();
    expect(email?.text).toBeNull();
  });

  it("con el crudo disponible no está vencido", async () => {
    mocks.row = row("pg:00000000-0000-4000-8000-000000000001");
    mocks.blob = { body: JSON.stringify({ content: { text: "hola", html: null } }) };
    const email = await getInboundEmail("u1", "e1");
    expect(email?.expired).toBe(false);
    expect(email?.text).toBe("hola");
  });

  it("una fila provisional (todavía sin crudo) no se muestra como vencida", async () => {
    mocks.row = row("pending:");
    const email = await getInboundEmail("u1", "e1");
    expect(email?.expired).toBe(false);
  });
});
