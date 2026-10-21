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
// Revisión 2026-07-28: las claves de _meta y el header mcp-method son obligatorios en la ruta moderna
const MODERN = "2026-07-28";
const MODERN_META = {
  "io.modelcontextprotocol/protocolVersion": MODERN,
  "io.modelcontextprotocol/clientInfo": { name: "e2e", version: "0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};
const MODERN_HEADERS = {
  ...HEADERS,
  authorization: `Bearer ${TOKEN}`,
  "mcp-protocol-version": MODERN,
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

  // Correr primero sin el arreglo para verlo en rojo
  test("subscriptions/listen responde enseguida, sin dejar un SSE abierto (ronda 99)", async ({
    request,
  }) => {
    const res = await request.post("/api/mcp", {
      headers: { ...MODERN_HEADERS, "mcp-method": "subscriptions/listen" },
      data: {
        jsonrpc: "2.0",
        id: 2,
        method: "subscriptions/listen",
        params: { notifications: { toolsListChanged: true }, _meta: MODERN_META },
      },
      // Sin el arreglo la respuesta es un SSE que no termina: el request vence y el test falla
      timeout: 10_000,
    });
    expect(res.headers()["content-type"]).toContain("application/json");
    const body = await res.json();
    expect(body.id).toBe(2);
    expect(body.error).toBeDefined();
  });

  test("server/discover no anuncia tools.listChanged (ronda 99)", async ({ request }) => {
    const res = await request.post("/api/mcp", {
      headers: { ...MODERN_HEADERS, "mcp-method": "server/discover" },
      data: { jsonrpc: "2.0", id: 3, method: "server/discover", params: { _meta: MODERN_META } },
      timeout: 10_000,
    });
    expect(res.ok()).toBe(true);
    const text = await res.text();
    // Respuesta de éxito (no un error JSON-RPC) con las capabilities tal cual las arma el SDK
    // (_ondiscover: mcp-DXXb3Vv3.mjs:1034-1039, discoverAdvertisedCapabilities :1291-1293)
    expect(text).not.toContain('"error"');
    expect(text).toContain('"supportedVersions"');
    expect(text).toContain(MODERN);
    expect(text).toMatch(/"tools":\s*\{[^}]*"listChanged":\s*false/);
  });
});
