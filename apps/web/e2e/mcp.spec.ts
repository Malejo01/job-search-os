import { expect, test } from "@playwright/test";

/**
 * MCP (JS-069): autenticación por token, sin navegador. El CI define MCP_TOKEN en el job de e2e
 * (.github/workflows/ci.yml) y no define MCP_ALLOW_QUERY_TOKEN, así que `?token=` debe fallar.
 * Local: el spec se saltea salvo que E2E_MCP_TOKEN coincida con el MCP_TOKEN del servidor.
 */
const TOKEN = process.env.MCP_TOKEN ?? process.env.E2E_MCP_TOKEN;
const HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};
const LIST = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };

test.describe("MCP /api/mcp", () => {
  test.skip(!TOKEN, "MCP_TOKEN no está definido en el entorno del e2e (lo define el job de CI)");

  test("sin token: 401", async ({ request }) => {
    const res = await request.post("/api/mcp", { headers: HEADERS, data: LIST });
    expect(res.status()).toBe(401);
  });

  test("?token= sin MCP_ALLOW_QUERY_TOKEN: 401", async ({ request }) => {
    test.skip(process.env.MCP_ALLOW_QUERY_TOKEN === "1", "el servidor acepta ?token= por diseño");
    const res = await request.post(`/api/mcp?token=${encodeURIComponent(TOKEN!)}`, {
      headers: HEADERS,
      data: LIST,
    });
    expect(res.status()).toBe(401);
  });

  test("Bearer válido: tools/list responde 200 con las tools", async ({ request }) => {
    const res = await request.post("/api/mcp", {
      headers: { ...HEADERS, authorization: `Bearer ${TOKEN}` },
      data: LIST,
    });
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("list_jobs");
    expect(body).toContain("get_job");
  });
});
