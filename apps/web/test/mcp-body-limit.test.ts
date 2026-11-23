import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/mcp: tope de cuerpo propio, antes de autenticar y de pasarle el pedido al handler de MCP.
 * Todo con dobles: sin base, sin red, sin modelo.
 */
const authenticate = vi.fn();
const handlerSeen: { body: string; method: string }[] = [];

vi.mock("mcp-handler", () => ({
  createMcpHandler: () => async (req: Request) => {
    handlerSeen.push({ body: await req.text(), method: req.method });
    return new Response("ok", { status: 200 });
  },
}));
vi.mock("@/lib/mcp-user", () => ({
  authenticateMcpRequest: (...args: unknown[]) => authenticate(...args),
  mcpUserIdFor: vi.fn(),
}));
vi.mock("@/lib/job-detail", () => ({
  applyJobEvent: vi.fn(),
  getJobDetail: vi.fn(),
  MANUAL_EVENTS: [],
}));
vi.mock("@/lib/jobs", () => ({ listJobs: vi.fn() }));
vi.mock("@/lib/market", () => ({ getMarket: vi.fn() }));
vi.mock("@/lib/ingest-manual", () => ({ ingestManualJob: vi.fn(), parseModality: vi.fn() }));
vi.mock("@/lib/evaluate-now", () => ({
  evaluateInBackgroundOrExplain: vi.fn(),
  notEvaluatedMessage: vi.fn(),
}));
vi.mock("@/lib/pending-jd", () => ({ attachJd: vi.fn(), listPendingJd: vi.fn() }));
vi.mock("@/lib/applicant", () => ({
  answersFromBank: vi.fn(),
  approveAnswer: vi.fn(),
  candidateProfile: vi.fn(),
  saveFormAnswers: vi.fn(),
}));
vi.mock("@job-search-os/adapters", () => ({
  mcpFailed: vi.fn(),
  untrustedContent: vi.fn(),
  guardMcpTool: vi.fn(),
}));

import { POST } from "../app/api/mcp/route";

const MAX = 256 * 1024;
const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("https://app.example/api/mcp", { method: "POST", body, headers });

beforeEach(() => {
  authenticate.mockReset();
  authenticate.mockResolvedValue({ ok: true, principal: { kind: "shared" } });
  handlerSeen.length = 0;
});

describe("tope de cuerpo de /api/mcp", () => {
  it("413 con Content-Length declarado grande, sin autenticar ni llamar al handler", async () => {
    const res = await POST(post("{}", { "content-length": String(MAX + 1) }));
    expect(res.status).toBe(413);
    expect(authenticate).not.toHaveBeenCalled();
    expect(handlerSeen).toHaveLength(0);
  });

  it("413 al cortar la lectura cuando el cuerpo real pasa el tope", async () => {
    const res = await POST(post("x".repeat(MAX + 10)));
    expect(res.status).toBe(413);
    expect(authenticate).not.toHaveBeenCalled();
    expect(handlerSeen).toHaveLength(0);
  });

  it("el 413 dice cuál es el máximo y cómo achicar el pedido", async () => {
    const res = await POST(post("x".repeat(MAX + 10)));
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("256 KB");
    expect(body.error).toContain("menos respuestas");
  });

  it("2 MB hostiles se rechazan en menos de 100 ms", async () => {
    const hostile = post("x".repeat(2 * 1024 * 1024));
    const t0 = performance.now();
    const res = await POST(hostile);
    expect(res.status).toBe(413);
    expect(performance.now() - t0).toBeLessThan(100);
  });

  it("una llamada normal sigue funcionando y el handler recibe el cuerpo entero", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const res = await POST(post(body));
    expect(res.status).toBe(200);
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(handlerSeen).toEqual([{ body, method: "POST" }]);
  });

  it("la autenticación sigue mandando: sin credencial, 401 aunque el cuerpo sea chico", async () => {
    authenticate.mockResolvedValue({ ok: false, status: 401 });
    const res = await POST(post("{}"));
    expect(res.status).toBe(401);
    expect(handlerSeen).toHaveLength(0);
  });
});
