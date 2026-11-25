import type * as Adapters from "@job-search-os/adapters";
import type * as Files from "../lib/feedback-files";
import type * as Voice from "../lib/voice/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ITEM = "33333333-3333-4333-8333-333333333333";
const FILE_ID = "44444444-4444-4444-8444-444444444444";

const mocks = vi.hoisted(() => ({
  session: "u1" as string | null,
  terms: false,
  tester: true,
  limited: false,
  stored: [] as { itemId: string; name: string; size: number }[],
  storeResult: null as unknown,
  loaded: null as unknown,
  deleteResult: { ok: true } as unknown,
  logs: [] as string[],
}));

vi.mock("@/lib/session", () => ({ sessionUserId: async () => mocks.session }));
vi.mock("@/lib/terms-status", () => ({ needsTermsAcceptance: async () => mocks.terms }));
vi.mock("@/lib/site-url", () => ({ siteUrl: () => "https://app.example" }));
vi.mock("@/lib/recorrido-access", () => ({ canViewRecorrido: async () => mocks.tester }));
vi.mock("@/lib/profile-agent/access", () => ({ getSessionEmail: async () => null }));
vi.mock("@/lib/voice/server", async () => ({
  readBytesLimited: (await vi.importActual<typeof Voice>("../lib/voice/server")).readBytesLimited,
}));
vi.mock("@/lib/db", () => ({ withUser: vi.fn() }));
vi.mock("@/lib/admin-guard", () => ({ isAdminUser: async () => false }));
vi.mock("@job-search-os/adapters", async (importActual) => {
  const actual = await importActual<typeof Adapters>();
  const push = (a: unknown[]) => mocks.logs.push(JSON.stringify(a));
  return {
    ...actual,
    createLogger: () => ({ info: push, warn: push, error: push }),
  };
});
vi.mock("@/lib/feedback-files", async () => {
  const actual = await vi.importActual<typeof Files>("../lib/feedback-files");
  return {
    ...actual,
    uploadRateLimited: async () => mocks.limited,
    storeFeedbackFile: async (
      _u: string,
      input: { itemId: string; name: string; bytes: Uint8Array },
    ) => {
      mocks.stored.push({ itemId: input.itemId, name: input.name, size: input.bytes.length });
      return mocks.storeResult;
    },
    loadFeedbackFile: async () => mocks.loaded,
    deleteFeedbackFile: async () => mocks.deleteResult,
  };
});

import { DELETE, GET } from "../app/api/feedback-files/[id]/route";
import { POST } from "../app/api/feedback-files/route";

const ORIGIN = "https://app.example";
const VIEW = { id: FILE_ID, name: "a.webp", kind: "image", bytes: 10, width: 4, height: 4 };

async function post(
  parts: Record<string, string | File>,
  opts: { origin?: string | null } = {},
): Promise<Response> {
  const form = new FormData();
  for (const [k, v] of Object.entries(parts)) form.append(k, v);
  const raw = new Response(form);
  const headers: Record<string, string> = { "content-type": raw.headers.get("content-type")! };
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin) headers.origin = origin;
  return POST(
    new Request(`${ORIGIN}/api/feedback-files`, {
      method: "POST",
      headers,
      body: new Uint8Array(await raw.arrayBuffer()),
    }),
  );
}
const goodParts = () => ({ itemId: ITEM, file: new File([Uint8Array.of(1, 2, 3)], "a.webp") });
const params = (id = FILE_ID) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  mocks.session = "u1";
  mocks.terms = false;
  mocks.tester = true;
  mocks.limited = false;
  mocks.stored = [];
  mocks.storeResult = { ok: true, attachment: VIEW };
  mocks.loaded = null;
  mocks.deleteResult = { ok: true };
  mocks.logs = [];
});

describe("POST /api/feedback-files", () => {
  it("sin sesión: 401 y no toca nada", async () => {
    mocks.session = null;
    const res = await post(goodParts());
    expect(res.status).toBe(401);
    expect(mocks.stored).toHaveLength(0);
  });

  it("otro origen o sin origen: 404", async () => {
    expect((await post(goodParts(), { origin: "https://sitio-malo.example" })).status).toBe(404);
    expect((await post(goodParts(), { origin: null })).status).toBe(404);
    expect(mocks.stored).toHaveLength(0);
  });

  it("una persona que no es tester ni admin: 404, igual que una ruta que no existe", async () => {
    mocks.tester = false;
    const res = await post(goodParts());
    expect(res.status).toBe(404);
    expect(mocks.stored).toHaveLength(0);
  });

  it("términos sin aceptar: 404", async () => {
    mocks.terms = true;
    expect((await post(goodParts())).status).toBe(404);
  });

  it("el límite de subidas corta antes de leer el cuerpo", async () => {
    mocks.limited = true;
    const res = await post(goodParts());
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("rate_limited");
    expect(mocks.stored).toHaveLength(0);
  });

  it("más de 4 MB por pedido: 413 sin guardar", async () => {
    const big = new File([new Uint8Array(4 * 1024 * 1024 + 70 * 1024)], "a.pdf");
    const res = await post({ itemId: ITEM, file: big });
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("request_too_large");
    expect(mocks.stored).toHaveLength(0);
  });

  it("sin archivo, sin itemId o con un itemId que no es UUID: 400", async () => {
    expect((await post({ itemId: ITEM })).status).toBe(400);
    expect((await post({ file: new File([Uint8Array.of(1)], "a.webp") })).status).toBe(400);
    expect(
      (await post({ itemId: "1; drop table", file: new File([Uint8Array.of(1)], "a") })).status,
    ).toBe(400);
  });

  it("camino feliz: 200 con los datos de la vista y sin la ref del archivo", async () => {
    const res = await post(goodParts());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, attachment: VIEW });
    expect(text).not.toContain("pgb:");
    expect(mocks.stored).toEqual([{ itemId: ITEM, name: "a.webp", size: 3 }]);
  });

  it("un rechazo de la validación vuelve con su código y su texto en llano", async () => {
    mocks.storeResult = { ok: false, error: "unsafe_pdf" };
    const res = await post(goodParts());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, error: "unsafe_pdf" });
    expect(String(body.message).length).toBeGreaterThan(5);
  });

  it("si la base falla: 500 sin el texto de la excepción", async () => {
    mocks.storeResult = Promise.reject(new Error("secreto: postgres://usuario:clave@host/db"));
    (mocks.storeResult as Promise<unknown>).catch(() => undefined);
    const res = await post(goodParts());
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("postgres://");
    expect(mocks.logs.join("\n")).not.toContain("postgres://");
  });

  it("los logs llevan códigos y tamaños, nunca el nombre del archivo", async () => {
    mocks.storeResult = { ok: false, error: "type" };
    await post({ itemId: ITEM, file: new File([Uint8Array.of(1, 2)], "mi-secreto-personal.pdf") });
    expect(mocks.logs.join("\n")).not.toContain("mi-secreto-personal");
  });
});

describe("GET /api/feedback-files/[id]", () => {
  const file = (over: Record<string, unknown> = {}) => ({
    kind: "pdf",
    mime: "application/pdf",
    name: "informe.pdf",
    bytes: new Uint8Array([37, 80, 68, 70]),
    ...over,
  });
  const get = (id?: string) => GET(new Request(`${ORIGIN}/api/feedback-files/x`), params(id));

  it("sin sesión: 401", async () => {
    mocks.session = null;
    expect((await get()).status).toBe(401);
  });

  it("un id que no es UUID o que no existe: el mismo 404", async () => {
    const bad = await get("../../etc/passwd");
    const missing = await get();
    expect(bad.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await bad.text()).toBe(await missing.text());
  });

  it("PDF y DOCX salen como attachment con las cabeceras seguras", async () => {
    mocks.loaded = file();
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([37, 80, 68, 70]);
  });

  it("solo el WebP reescrito va inline", async () => {
    mocks.loaded = file({ kind: "image", mime: "image/webp", name: "captura.webp" });
    expect((await get()).headers.get("content-disposition")).toMatch(/^inline;/);
  });
});

describe("DELETE /api/feedback-files/[id]", () => {
  const del = (origin: string | null = ORIGIN, id?: string) =>
    DELETE(
      new Request(`${ORIGIN}/api/feedback-files/x`, {
        method: "DELETE",
        headers: origin ? { origin } : {},
      }),
      params(id),
    );

  it("sin sesión: 401; otro origen: 404; id inválido: 404", async () => {
    mocks.session = null;
    expect((await del()).status).toBe(401);
    mocks.session = "u1";
    expect((await del("https://sitio-malo.example")).status).toBe(404);
    expect((await del(ORIGIN, "no-es-uuid")).status).toBe(404);
  });

  it("borra y responde ok; con el informe enviado responde 409", async () => {
    expect((await del()).status).toBe(200);
    mocks.deleteResult = { ok: false, error: "report_locked" };
    expect((await del()).status).toBe(409);
    mocks.deleteResult = { ok: false, error: "not_found" };
    expect((await del()).status).toBe(404);
  });
});
