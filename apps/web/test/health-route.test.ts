import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAppRole: vi.fn(async () => undefined),
  execute: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => ({
  assertAppRole: mocks.assertAppRole,
  getAppDb: () => ({ execute: mocks.execute }),
}));
vi.mock("@job-search-os/adapters", () => ({
  createLogger: () => ({ error: vi.fn() }),
  safeDbError: (e: unknown) => e,
  checkBearerSecret: ({
    authorization,
    expected,
  }: {
    authorization: string | null;
    expected: string | undefined;
  }) => Boolean(expected) && authorization === `Bearer ${expected}`,
}));

import { GET } from "../app/api/health/route";

const get = (headers: Record<string, string> = {}) =>
  GET(new Request("https://app.example/api/health", { headers }));

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "secreto-de-prueba");
    mocks.assertAppRole.mockClear();
    mocks.execute.mockClear();
  });

  it("sin bearer no consulta la base y lleva el header de caché", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=15");
    expect(await res.json()).toMatchObject({ ok: true });
    expect(mocks.assertAppRole).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("la respuesta pública no trae datos de la base", async () => {
    const body = (await (await get()).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["commit", "ok"]);
  });

  it("con un bearer equivocado tampoco consulta la base", async () => {
    const res = await get({ authorization: "Bearer otro" });
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=15");
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("con bearer válido consulta la base y la respuesta no se cachea", async () => {
    const res = await get({ authorization: "Bearer secreto-de-prueba" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ ok: true, db: "ok" });
    expect(mocks.assertAppRole).toHaveBeenCalledTimes(1);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("con bearer válido y la base caída responde 503 sin caché ni detalle", async () => {
    mocks.execute.mockRejectedValueOnce(new Error("detalle interno"));
    const res = await get({ authorization: "Bearer secreto-de-prueba" });
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(await res.json())).not.toContain("detalle interno");
  });

  it("sin CRON_SECRET configurado ningún bearer abre el ping", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await get({ authorization: "Bearer " });
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=15");
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
