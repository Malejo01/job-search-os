import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadInboundContent: vi.fn(),
  processInboundEvent: vi.fn(),
  close: vi.fn(async () => undefined),
}));

vi.mock("@job-search-os/db", () => ({
  createDb: () => ({ db: {}, close: mocks.close }),
  requireDatabaseUrl: () => "postgres://prueba",
}));

vi.mock("@job-search-os/adapters", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
  loadInboundContent: mocks.loadInboundContent,
  pgBlobStorage: () => ({}),
  processInboundEvent: mocks.processInboundEvent,
  ResendAnyEventSchema: {
    safeParse: (v: unknown) => ({ success: true, data: v }),
  },
  ResendReceivedEventSchema: {
    safeParse: (v: unknown) => ({ success: true, data: v }),
  },
  safeDbError: (e: unknown) => e,
  SVIX_INVALID_SECRET_REASON: "secreto inválido",
  verifySvix: () => ({ ok: true }),
}));

import { POST } from "../app/api/inbound/route";

const request = () =>
  new Request("https://app.example.com/api/inbound", {
    method: "POST",
    body: JSON.stringify({ type: "email.received", data: { email_id: "em_1" } }),
  });

describe("POST /api/inbound", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "clave-de-prueba");
    mocks.loadInboundContent.mockReset();
    mocks.processInboundEvent.mockReset();
    mocks.processInboundEvent.mockImplementation(
      async (_event: unknown, _raw: string, fetchContent: () => Promise<unknown>) => {
        await fetchContent();
        return { kind: "unknown_recipient", recipientsCount: 0 };
      },
    );
  });

  it("si la API de correo responde 429 devuelve 500 para que se reintente", async () => {
    mocks.loadInboundContent.mockRejectedValue(new Error("HTTP 429"));
    const res = await POST(request());
    expect(res.status).toBe(500);
    expect(mocks.close).toHaveBeenCalled();
  });

  it("con el cuerpo disponible responde 200", async () => {
    mocks.loadInboundContent.mockResolvedValue({ html: null, text: "hola", headers: null });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(mocks.loadInboundContent).toHaveBeenCalledTimes(1);
  });

  it("sin clave de API no pide el cuerpo", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(mocks.loadInboundContent).not.toHaveBeenCalled();
  });
});
