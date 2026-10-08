import type { CriteriaRules, RawJob } from "@job-search-os/pipeline";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../logger";
import {
  parseEnabledSources,
  runExtraSourcesIngest,
  safeError,
  type ExtraSourceDownloaders,
  type RunExtraSourcesDeps,
} from "./run-sources";

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child() {
    return logger;
  },
} as unknown as Logger;

const job = (id: string) => ({ source: { externalId: id } }) as unknown as RawJob;

const summary = (received: number) => ({
  received,
  inserted: received,
  merged: 0,
  byStatus: {},
  enqueued: 0,
  errors: [],
});

function makeDeps(overrides: Partial<RunExtraSourcesDeps> = {}): RunExtraSourcesDeps {
  return {
    loadUsers: async () => ({
      users: [{ userId: "u1", rules: {} as CriteriaRules }],
      taxonomy: [],
    }),
    ingest: vi.fn(async (jobs: RawJob[]) => summary(jobs.length)),
    ...overrides,
  };
}

function downloaders(partial: Partial<ExtraSourceDownloaders>): ExtraSourceDownloaders {
  const none = vi.fn(async () => {
    throw new Error("no debería llamarse");
  });
  return { remoteok: none, wwr: none, himalayas: none, torre: none, ...partial };
}

const base = {
  db: {} as never,
  logger,
  sinceHours: 24,
  now: () => new Date("2026-10-07T12:00:00Z"),
};

describe("runExtraSourcesIngest con userId", () => {
  it("solo ingiere para ese usuario aunque loadUsers devuelva más", async () => {
    const ingest = vi.fn(async (jobs: RawJob[], _userId: string, _rules: CriteriaRules) =>
      summary(jobs.length),
    );
    const deps = makeDeps({
      loadUsers: async () => ({
        users: [
          { userId: "u1", rules: {} as CriteriaRules },
          { userId: "u2", rules: {} as CriteriaRules },
        ],
        taxonomy: [],
      }),
      ingest,
    });
    const r = await runExtraSourcesIngest(
      {
        ...base,
        userId: "u2",
        enabled: ["remoteok"],
        downloaders: downloaders({ remoteok: async () => [job("1")] }),
      },
      deps,
    );
    expect(r.sources[0]).toMatchObject({ status: "ok", users: 1 });
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest.mock.calls[0]![1]).toBe("u2");
  });

  it("sin userId ingiere para todos", async () => {
    const ingest = vi.fn(async (jobs: RawJob[]) => summary(jobs.length));
    const deps = makeDeps({
      loadUsers: async () => ({
        users: [
          { userId: "u1", rules: {} as CriteriaRules },
          { userId: "u2", rules: {} as CriteriaRules },
        ],
        taxonomy: [],
      }),
      ingest,
    });
    const r = await runExtraSourcesIngest(
      {
        ...base,
        enabled: ["remoteok"],
        downloaders: downloaders({ remoteok: async () => [job("1")] }),
      },
      deps,
    );
    expect(r.sources[0]).toMatchObject({ users: 2 });
  });
});

describe("parseEnabledSources", () => {
  it("vacío, undefined o solo espacios = ninguna", () => {
    for (const v of [undefined, "", "   ", " , ,"]) {
      expect(parseEnabledSources(v)).toEqual({ enabled: [], unknown: [] });
    }
  });

  it("recorta espacios, pasa a minúsculas y quita repetidos", () => {
    expect(parseEnabledSources(" RemoteOK , wwr,REMOTEOK , Himalayas ")).toEqual({
      enabled: ["remoteok", "wwr", "himalayas"],
      unknown: [],
    });
  });

  it("separa los desconocidos", () => {
    expect(parseEnabledSources("torre,linkedin,Foo,foo")).toEqual({
      enabled: ["torre"],
      unknown: ["linkedin", "foo"],
    });
  });
});

describe("runExtraSourcesIngest", () => {
  it("una fuente prendida ingiere y las apagadas no se llaman", async () => {
    const remoteok = vi.fn(async () => [job("a"), job("b")]);
    const wwr = vi.fn(async () => [job("c")]);
    const deps = makeDeps();
    const out = await runExtraSourcesIngest(
      { ...base, enabled: ["remoteok"], downloaders: downloaders({ remoteok, wwr }) },
      deps,
    );
    expect(out.sources).toEqual([
      {
        name: "remoteok",
        status: "ok",
        fetched: 2,
        users: 1,
        inserted: 2,
        merged: 0,
        discarded: 0,
        errors: 0,
      },
    ]);
    expect(remoteok).toHaveBeenCalledTimes(1);
    expect(wwr).not.toHaveBeenCalled();
    expect(deps.ingest).toHaveBeenCalledTimes(1);
  });

  it("una que tira error no corta a las demás y no filtra el body", async () => {
    const remoteok = vi.fn(async () => {
      throw new Error("HTTP 500");
    });
    const wwr = vi.fn(async () => [job("c")]);
    const out = await runExtraSourcesIngest(
      { ...base, enabled: ["remoteok", "wwr"], downloaders: downloaders({ remoteok, wwr }) },
      makeDeps(),
    );
    expect(out.sources[0]).toMatchObject({ name: "remoteok", status: "error", fetched: 0 });
    expect(out.sources[0]?.error).toBe("HTTP 500");
    expect(out.sources[1]).toMatchObject({ name: "wwr", status: "ok", fetched: 1, users: 1 });
  });

  it("el presupuesto corta la siguiente fuente", async () => {
    let t = 0;
    const remoteok = vi.fn(async () => [job("a")]);
    const wwr = vi.fn(async () => [job("c")]);
    const ingest = vi.fn(async (jobs: RawJob[]) => {
      t += 50_000;
      return summary(jobs.length);
    });
    const out = await runExtraSourcesIngest(
      {
        ...base,
        enabled: ["remoteok", "wwr"],
        budgetMs: 40_000,
        clock: () => t,
        downloaders: downloaders({ remoteok, wwr }),
      },
      makeDeps({ ingest }),
    );
    expect(out.sources[0]?.status).toBe("ok");
    expect(out.sources[1]).toMatchObject({
      name: "wwr",
      status: "skipped",
      skipped: "presupuesto",
    });
    expect(wwr).not.toHaveBeenCalled();
  });

  it("el timeout por fuente aborta la descarga", async () => {
    const himalayas = vi.fn(
      ({ signal }: { signal?: AbortSignal }) =>
        new Promise<RawJob[]>((_, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("abortada")));
        }),
    );
    const torre = vi.fn(async () => [job("t")]);
    const out = await runExtraSourcesIngest(
      {
        ...base,
        enabled: ["himalayas", "torre"],
        perSourceTimeoutMs: 20,
        downloaders: downloaders({ himalayas, torre }),
      },
      makeDeps(),
    );
    expect(out.sources[0]).toMatchObject({ name: "himalayas", status: "error" });
    expect(out.sources[1]?.status).toBe("ok");
  });

  it("un fetch que ignora la señal y nunca resuelve igual sale por timeout", async () => {
    const never = vi.fn(() => new Promise<Response>(() => {}));
    const out = await runExtraSourcesIngest(
      { ...base, enabled: ["remoteok"], perSourceTimeoutMs: 20, fetchImpl: never as never },
      makeDeps(),
    );
    expect(never).toHaveBeenCalledTimes(1);
    expect(out.sources[0]).toMatchObject({ name: "remoteok", status: "error", error: "timeout" });
    expect(out.ok).toBe(false);
  });

  it("si la descarga trae algo pero venció el timeout, no es ok", async () => {
    const wwr = vi.fn(async ({ signal }: { signal?: AbortSignal }) => {
      await new Promise((r) => setTimeout(r, 40));
      expect(signal?.aborted).toBe(true);
      return [job("x")];
    });
    const out = await runExtraSourcesIngest(
      { ...base, enabled: ["wwr"], perSourceTimeoutMs: 10, downloaders: downloaders({ wwr }) },
      makeDeps(),
    );
    expect(out.sources[0]).toMatchObject({ status: "error", error: "timeout", fetched: 1 });
  });

  it("el timeout de la descarga no pasa lo que queda del presupuesto", async () => {
    const seen: number[] = [];
    const remoteok = vi.fn(async ({ signal }: { signal?: AbortSignal }) => {
      await new Promise((r) => setTimeout(r, 60));
      seen.push(signal?.aborted ? 1 : 0);
      return [job("a")];
    });
    const out = await runExtraSourcesIngest(
      {
        ...base,
        enabled: ["remoteok"],
        budgetMs: 15,
        perSourceTimeoutMs: 10_000,
        downloaders: downloaders({ remoteok }),
      },
      makeDeps(),
    );
    expect(seen).toEqual([1]);
    expect(out.sources[0]?.status).toBe("error");
  });

  it("si se acaba el presupuesto entre usuarios queda partial", async () => {
    let t = 0;
    const remoteok = vi.fn(async () => [job("a")]);
    const ingest = vi.fn(async (jobs: RawJob[]) => {
      t += 50_000;
      return summary(jobs.length);
    });
    const out = await runExtraSourcesIngest(
      {
        ...base,
        enabled: ["remoteok"],
        budgetMs: 40_000,
        clock: () => t,
        downloaders: downloaders({ remoteok }),
      },
      makeDeps({
        ingest,
        loadUsers: async () => ({
          users: [
            { userId: "u1", rules: {} as CriteriaRules },
            { userId: "u2", rules: {} as CriteriaRules },
          ],
          taxonomy: [],
        }),
      }),
    );
    expect(out.sources[0]).toMatchObject({ status: "partial", users: 1 });
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it("un usuario que falla no corta a los demás de esa fuente", async () => {
    const remoteok = vi.fn(async () => [job("a")]);
    const ingest = vi.fn().mockRejectedValueOnce(new Error("rls")).mockResolvedValue(summary(1));
    const out = await runExtraSourcesIngest(
      { ...base, enabled: ["remoteok"], downloaders: downloaders({ remoteok }) },
      makeDeps({
        ingest,
        loadUsers: async () => ({
          users: [
            { userId: "u1", rules: {} as CriteriaRules },
            { userId: "u2", rules: {} as CriteriaRules },
          ],
          taxonomy: [],
        }),
      }),
    );
    expect(ingest).toHaveBeenCalledTimes(2);
    expect(out.sources[0]).toMatchObject({ status: "partial", users: 1 });
  });

  it("un error de base con parámetros no aparece en la respuesta", async () => {
    const leak = "Failed query: insert into jobs ... params: texto-de-aviso,user-uuid-123";
    const remoteok = vi.fn(async () => [job("a")]);
    const wwr = vi.fn(async () => {
      throw new Error(leak);
    });
    const ingest = vi.fn().mockRejectedValue(new Error(leak));
    const out = await runExtraSourcesIngest(
      { ...base, enabled: ["remoteok", "wwr"], downloaders: downloaders({ remoteok, wwr }) },
      makeDeps({ ingest }),
    );
    const json = JSON.stringify(out);
    expect(json).not.toContain("texto-de-aviso");
    expect(json).not.toContain("user-uuid-123");
    expect(out.sources.map((s) => s.error)).toEqual(["error al ingerir", "error al descargar"]);
  });

  it("un error de base con la señal ya vencida sale como error al ingerir, no timeout", async () => {
    const remoteok = vi.fn(async () => [job("a")]);
    const out = await runExtraSourcesIngest(
      {
        ...base,
        enabled: ["remoteok"],
        perSourceTimeoutMs: 10,
        downloaders: downloaders({ remoteok }),
      },
      makeDeps({
        loadUsers: async () => {
          await new Promise((r) => setTimeout(r, 40));
          throw new Error("Failed query: select ... params: dato-privado");
        },
      }),
    );
    expect(out.sources[0]).toMatchObject({ status: "error", error: "error al ingerir" });
  });

  it("safeError usa una lista cerrada y recortada", () => {
    expect(safeError(new Error("Remote OK: HTTP 503"))).toBe("HTTP 503");
    expect(safeError(new Error("x"), true)).toBe("timeout");
    expect(safeError(new Error("timeout de la fuente"))).toBe("timeout");
    expect(safeError("cualquier cosa " + "x".repeat(500), false, "ingerir")).toBe(
      "error al ingerir",
    );
  });

  it("un error de ingesta de una fuente se aísla", async () => {
    const remoteok = vi.fn(async () => [job("a")]);
    const wwr = vi.fn(async () => [job("c")]);
    const ingest = vi
      .fn()
      .mockRejectedValueOnce(new Error("db caída"))
      .mockResolvedValue(summary(1));
    const out = await runExtraSourcesIngest(
      { ...base, enabled: ["remoteok", "wwr"], downloaders: downloaders({ remoteok, wwr }) },
      makeDeps({ ingest }),
    );
    expect(out.sources.map((s) => s.status)).toEqual(["error", "ok"]);
  });
});
