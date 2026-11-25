import type * as Db from "@job-search-os/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executed: 0,
  result: [{ files_deleted: 3, bytes_freed: "1048576" }] as unknown,
  fail: false,
}));

vi.mock("@job-search-os/db", async (importActual) => ({
  ...(await importActual<typeof Db>()),
  createDb: () => ({
    db: {
      execute: async () => {
        mocks.executed += 1;
        if (mocks.fail) throw new Error("postgres://usuario:clave@host/db");
        return mocks.result;
      },
    },
    close: async () => undefined,
  }),
  requireDatabaseUrl: () => "postgres://fake",
}));

import { GET } from "../app/api/cron/purge-attachments/route";

const call = (secret: string | null = "secreto-de-prueba") =>
  GET(
    new Request("https://app.example/api/cron/purge-attachments", {
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    }),
  );

beforeEach(() => {
  mocks.executed = 0;
  mocks.fail = false;
  vi.stubEnv("CRON_SECRET", "secreto-de-prueba");
  vi.stubEnv("ATTACHMENTS_PURGE_ENABLED", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/cron/purge-attachments", () => {
  it("sin el secreto o con otro: 401 y no toca la base", async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call("otro")).status).toBe(401);
    expect(mocks.executed).toBe(0);
  });

  it("apagado por defecto: no hace nada", async () => {
    vi.stubEnv("ATTACHMENTS_PURGE_ENABLED", "");
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, enabled: false });
    expect(mocks.executed).toBe(0);
  });

  it("encendido: corre la función y devuelve solo conteos y el run_id", async () => {
    const res = await call();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, enabled: true, files: 3, bytes: 1048576 });
    expect(body.run_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.executed).toBe(1);
  });

  it("si la base falla: 500 sin el texto de la excepción", async () => {
    mocks.fail = true;
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("postgres://");
  });
});
