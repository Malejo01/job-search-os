import { createHash, randomBytes } from "node:crypto";
import * as s from "@job-search-os/db/schema";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  createJob,
  deleteJob,
  E2E_B_USER_ID,
  E2E_USER_ID,
  ensureSecondUser,
  login,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
  seedSecondUserData,
  type SecondUserData,
} from "./helpers";

/**
 * Flujo 124 (MCP-1): tokens personales del MCP, por HTTP contra /api/mcp.
 *
 * El server de e2e corre con `MCP_USER_TOKENS=testers` y `MCP_USER_ID` = la persona B
 * (playwright.config.ts). El usuario seed (A) es admin en el CI, así que pasa el gate de testers
 * (mismo criterio que el asistente); B no. Sin MCP_ALLOW_QUERY_TOKEN: todo va por Bearer.
 *
 * Los tokens que se crean a mano en la base son textos aleatorios del momento con el formato
 * `afj_…`: nunca valen fuera de esta corrida. Se generan acá con node:crypto (sin
 * @job-search-os/adapters, que Playwright no transpila).
 */
const SHARED = process.env.MCP_TOKEN ?? process.env.E2E_MCP_TOKEN;
const HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

const newToken = () => `afj_${randomBytes(32).toString("base64url")}`;
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

async function insertToken(
  userId: string,
  token: string,
  opts: { expired?: boolean; label?: string } = {},
): Promise<void> {
  const { db, close } = ownerDb();
  try {
    const now = Date.now();
    await db.insert(s.mcpTokens).values({
      userId,
      tokenHash: sha(token),
      label: opts.label ?? "Token e2e",
      expiresAt: new Date(opts.expired ? now - 60_000 : now + 24 * 60 * 60 * 1000),
    });
  } finally {
    await close();
  }
}

async function removeTokensOf(userId: string): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.mcpTokens).where(eq(s.mcpTokens.userId, userId));
  } finally {
    await close();
  }
}

let rpcId = 0;
async function mcp(
  request: APIRequestContext,
  token: string,
  method: "tools/list" | "tools/call",
  params: Record<string, unknown> = {},
): Promise<{ status: number; body: string }> {
  const res = await request.post("/api/mcp", {
    headers: { ...HEADERS, authorization: `Bearer ${token}` },
    data: { jsonrpc: "2.0", id: ++rpcId, method, params },
  });
  return { status: res.status(), body: await res.text() };
}

const listJobs = (request: APIRequestContext, token: string) =>
  mcp(request, token, "tools/call", {
    name: "list_jobs",
    arguments: { status: "todas", limit: 50 },
  });
const getJob = (request: APIRequestContext, token: string, id: string) =>
  mcp(request, token, "tools/call", { name: "get_job", arguments: { id } });

test.describe.configure({ mode: "serial" });

test.describe("Flujo 124: tokens personales del MCP", () => {
  const titleA = `Oferta Ficticia MCP A ${Date.now()}`;
  let jobA: string;
  let dataB: SecondUserData;
  let tokenA: string;

  test.beforeAll(async () => {
    jobA = await createJob({ title: titleA, status: "evaluada" });
    dataB = await seedSecondUserData(`mcp-${Date.now()}`);
  });

  test.afterAll(async () => {
    await removeTokensOf(E2E_USER_ID);
    await deleteJob(jobA).catch(() => {});
    await removeSecondUser().catch(() => {});
  });

  test("A (tester) genera un token y ve la URL una sola vez", async ({ page }) => {
    await login(page);
    await page.goto("/settings");
    await page.getByRole("link", { name: /Conexiones con chats/ }).click();
    await expect(page).toHaveURL(/\/settings\/conexiones$/);
    await page.getByLabel("Nombre de la conexión").fill("ChatGPT e2e");
    await page.getByRole("button", { name: "Generar token" }).click();
    const created = page.getByTestId("mcp-token-creado");
    await expect(created).toContainText("no se vuelve a mostrar");
    const url = (await page.getByTestId("mcp-token-url").textContent()) ?? "";
    expect(url).toMatch(/\/api\/mcp\?token=afj_[A-Za-z0-9_-]{43}$/);
    tokenA = new URL(url).searchParams.get("token")!;

    // Recargar no la vuelve a mostrar: la lista solo tiene nombre, fechas y estado
    await page.reload();
    await expect(page.getByTestId("mcp-token-creado")).toHaveCount(0);
    await expect(page.getByText(tokenA)).toHaveCount(0);
    const row = page.getByTestId("mcp-token").filter({ hasText: "ChatGPT e2e" });
    await expect(row).toContainText("Activo");

    // En la base, solo el hash
    const { db, close } = ownerDb();
    try {
      const rows = await db
        .select({ hash: s.mcpTokens.tokenHash })
        .from(s.mcpTokens)
        .where(eq(s.mcpTokens.userId, E2E_USER_ID));
      expect(rows.map((r) => r.hash)).toContain(sha(tokenA));
      expect(JSON.stringify(rows)).not.toContain(tokenA);
    } finally {
      await close();
    }
  });

  test("el token de A ve lo de A y nunca lo de B (list_jobs y get_job)", async ({ request }) => {
    const list = await listJobs(request, tokenA);
    expect(list.status).toBe(200);
    expect(list.body).not.toContain(dataB.title);
    expect(list.body).not.toContain(dataB.jobId);

    const own = await getJob(request, tokenA, jobA);
    expect(own.status).toBe(200);
    expect(own.body).toContain(titleA);

    const other = await getJob(request, tokenA, dataB.jobId);
    expect(other.status).toBe(200);
    expect(other.body).toContain("oferta inexistente");
    expect(other.body).not.toContain(dataB.title);
    expect(other.body).not.toContain(dataB.jdToken);
  });

  test("las tools de lectura van con readOnlyHint y las que escriben no", async ({ request }) => {
    const res = await mcp(request, tokenA, "tools/list");
    expect(res.status).toBe(200);
    const tools = JSON.parse(res.body.slice(res.body.indexOf("{"), res.body.lastIndexOf("}") + 1))
      .result.tools as { name: string; annotations?: { readOnlyHint?: boolean } }[];
    const ro = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name);
    expect(ro.sort()).toEqual(
      [
        "get_candidate_profile",
        "get_job",
        "list_answers",
        "list_jobs",
        "list_pending_jd",
        "market_summary",
      ].sort(),
    );
    expect(tools).toHaveLength(11);
  });

  test("MCP_TOKEN sigue resolviendo a MCP_USER_ID y alternar con A no mezcla cuentas", async ({
    request,
  }) => {
    test.skip(!SHARED, "MCP_TOKEN no está definido en el entorno del e2e (lo define el job de CI)");
    for (let i = 0; i < 2; i++) {
      const a = await getJob(request, tokenA, jobA);
      expect(a.body).toContain(titleA);
      const shared = await listJobs(request, SHARED!);
      expect(shared.status).toBe(200);
      expect(shared.body).toContain(dataB.title);
      expect(shared.body).not.toContain(titleA);
      const aList = await listJobs(request, tokenA);
      expect(aList.body).not.toContain(dataB.title);
    }
  });

  test("el token de alguien fuera de la lista de testers da 401", async ({ request }) => {
    await ensureSecondUser();
    const tokenB = newToken();
    await insertToken(E2E_B_USER_ID, tokenB);
    const res = await listJobs(request, tokenB);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: "no autorizado" });
    expect(res.body).not.toContain(tokenB);
  });

  test("token vencido, inexistente o mal formado: 401 igual, sin el token en la respuesta", async ({
    request,
  }) => {
    const expired = newToken();
    await insertToken(E2E_USER_ID, expired, { expired: true, label: "Vencido e2e" });
    for (const t of [expired, newToken(), "afj_corto", "cualquier-cosa"]) {
      const res = await mcp(request, t, "tools/list");
      expect(res.status, t.slice(0, 8)).toBe(401);
      expect(JSON.parse(res.body)).toEqual({ error: "no autorizado" });
      expect(res.body).not.toContain(t);
    }
  });

  test("la llamada 61 dentro de un minuto da 429", async ({ request }) => {
    const limited = newToken();
    await insertToken(E2E_USER_ID, limited, { label: "Tope e2e" });
    for (let i = 1; i <= 60; i++) {
      const res = await mcp(request, limited, "tools/list");
      expect(res.status, `llamada ${i}`).toBe(200);
    }
    const res = await mcp(request, limited, "tools/list");
    expect(res.status).toBe(429);
    expect(JSON.parse(res.body)).toEqual({ error: "demasiadas llamadas" });
    expect(res.body).not.toContain(limited);
    // El tope es por token: el de A sigue andando
    expect((await mcp(request, tokenA, "tools/list")).status).toBe(200);
  });

  test("A revoca el token y deja de andar al instante", async ({ page, request }) => {
    await login(page);
    await page.goto("/settings/conexiones");
    const row = page.getByTestId("mcp-token").filter({ hasText: "ChatGPT e2e" });
    await row.getByRole("button", { name: /Revocar/ }).click();
    await expect(row).toContainText("Revocado");
    const res = await listJobs(request, tokenA);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: "no autorizado" });
  });

  test("una persona que no es tester no ve la pantalla ni el link", async ({ page }) => {
    await ensureSecondUser();
    await loginAsSecondUser(page);
    await page.goto("/settings");
    await expect(page.getByRole("link", { name: /Conexiones con chats/ })).toHaveCount(0);
    const res = await page.goto("/settings/conexiones");
    expect(res?.status()).toBe(404);
  });
});
