import type { RawJob } from "@job-search-os/pipeline";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../logger";
import {
  atsDownloader,
  parsePoolBackfillDays,
  parsePoolSources,
  poolErrorCode,
  poolIntervalMs,
  POOL_MAX_JOBS_PER_SOURCE,
  POOL_RECOMMENDED_SOURCES,
  POOL_MIN_INTERVAL_MS,
  POOL_SOURCE_KIND,
  runPoolFetch,
  type PoolBoard,
  type PoolBoardOutcome,
  type PoolDownloaders,
  type PoolFetchFinish,
  type PoolFetchHistory,
  type PoolSourceName,
  type RunPoolFetchDeps,
} from "./fetch";
import type { PoolUpsertSummary } from "./upsert";

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child() {
    return logger;
  },
} as unknown as Logger;

const NOW = new Date("2026-10-12T12:00:00Z");
const job = (id: string) => ({ source: { externalId: id } }) as unknown as RawJob;
const summary = (n: number, over: Partial<PoolUpsertSummary> = {}): PoolUpsertSummary => ({
  received: n,
  inserted: n,
  updated: 0,
  unchanged: 0,
  copies: 0,
  skipped: 0,
  errors: 0,
  stopped: false,
  ...over,
});

function downloaders(partial: Partial<PoolDownloaders>): PoolDownloaders {
  const none = vi.fn(async () => {
    throw new Error("no debería llamarse");
  });
  return {
    getonboard: none,
    remoteok: none,
    jobicy: none,
    himalayas: none,
    wwr: none,
    greenhouse: none,
    lever: none,
    ashby: none,
    ...partial,
  };
}

type Recorded = { id: string; source: PoolSourceName; startedAt: Date; finish?: PoolFetchFinish };

function makeDeps(
  history: Partial<Record<PoolSourceName, PoolFetchHistory>> = {},
  over: Partial<RunPoolFetchDeps> = {},
) {
  const rows: Recorded[] = [];
  const deps: RunPoolFetchDeps = {
    upsert: vi.fn(async (raws) => summary(raws.length)),
    lastFetches: vi.fn(
      async (source: PoolSourceName) =>
        history[source] ?? { lastGoodStartedAt: null, lastErrorCode: null },
    ),
    recordStart: vi.fn(async (source, startedAt) => {
      rows.push({ id: `r${rows.length}`, source, startedAt });
      return `r${rows.length - 1}`;
    }),
    recordFinish: vi.fn(async (id, finish) => {
      rows.find((r) => r.id === id)!.finish = finish;
    }),
    lastAttempts: vi.fn(async () => ({})),
    loadBoards: vi.fn(async () => []),
    updateBoards: vi.fn(async () => {}),
    ...over,
  };
  return { deps, rows };
}

const base = { db: {} as never, logger, now: () => NOW };
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe("parsePoolSources", () => {
  it("sin definir → ninguna: el pool no consulta nada hasta que se define la variable", () => {
    expect(parsePoolSources(undefined)).toEqual({ enabled: [], unknown: [] });
  });

  it("las recomendadas son siete y no incluyen Himalayas", () => {
    expect([...POOL_RECOMMENDED_SOURCES]).toEqual([
      "getonboard",
      "remoteok",
      "jobicy",
      "wwr",
      "greenhouse",
      "lever",
      "ashby",
    ]);
  });

  it("vacío o solo espacios → ninguna", () => {
    for (const v of ["", "   ", " , ,"]) {
      expect(parsePoolSources(v)).toEqual({ enabled: [], unknown: [] });
    }
  });

  it("recorta, pasa a minúsculas, quita repetidos y separa desconocidos", () => {
    expect(parsePoolSources(" GetOnBoard , jobicy,JOBICY,himalayas,linkedin,Foo,foo")).toEqual({
      enabled: ["getonboard", "jobicy", "himalayas"],
      unknown: ["linkedin", "foo"],
    });
  });
});

describe("POOL_SOURCE_KIND", () => {
  it("Get on Board se registra como getonboard_api; las demás con su nombre", () => {
    expect(POOL_SOURCE_KIND).toEqual({
      getonboard: "getonboard_api",
      remoteok: "remoteok",
      jobicy: "jobicy",
      himalayas: "himalayas",
      wwr: "wwr",
      greenhouse: "greenhouse",
      lever: "lever",
      ashby: "ashby",
    });
  });
});

describe("poolErrorCode e intervalos", () => {
  it("lista cerrada de códigos", () => {
    expect(poolErrorCode(new Error("Jobicy: HTTP 429"))).toBe("http_429");
    expect(poolErrorCode(new Error("Remote OK: HTTP 404"))).toBe("http_4xx");
    expect(poolErrorCode(new Error("Get on Board programming p1: HTTP 503"))).toBe("http_5xx");
    expect(poolErrorCode(new Error("Jobicy: respuesta inesperada"))).toBe("parse");
    expect(poolErrorCode(new Error("Remote OK: la respuesta no es un array"))).toBe("parse");
    expect(poolErrorCode(new SyntaxError("Unexpected token"))).toBe("parse");
    expect(poolErrorCode(new Error("timeout de la fuente"))).toBe("timeout");
    expect(poolErrorCode(new Error("x"), true)).toBe("timeout");
    expect(poolErrorCode(new Error("Failed query: ... params: dato-privado"))).toBe("unknown");
    expect(poolErrorCode("texto")).toBe("unknown");
  });

  it("intervalos: 5 h para las de 6 h, 23 h para Himalayas, el doble tras un 429", () => {
    expect(POOL_MIN_INTERVAL_MS.getonboard).toBe(5 * 3_600_000);
    expect(POOL_MIN_INTERVAL_MS.remoteok).toBe(5 * 3_600_000);
    expect(POOL_MIN_INTERVAL_MS.jobicy).toBe(5 * 3_600_000);
    expect(POOL_MIN_INTERVAL_MS.himalayas).toBe(23 * 3_600_000);
    expect(poolIntervalMs("jobicy", null)).toBe(5 * 3_600_000);
    expect(poolIntervalMs("jobicy", "timeout")).toBe(5 * 3_600_000);
    expect(poolIntervalMs("jobicy", "http_429")).toBe(10 * 3_600_000);
  });
});

describe("runPoolFetch", () => {
  it("una fuente prendida descarga con since de backfill y user-agent, y llama al upsert", async () => {
    const remoteok = vi.fn(async (_args: { since: Date; userAgent: string }) => [
      job("a"),
      job("b"),
    ]);
    const jobicy = vi.fn(async () => [job("c")]);
    const { deps, rows } = makeDeps();
    const out = await runPoolFetch(
      {
        ...base,
        enabled: ["remoteok"],
        userAgent: "JobSearchOS/1.0 (+https://app.example.com)",
        downloaders: downloaders({ remoteok, jobicy }),
      },
      deps,
    );
    expect(out.ok).toBe(true);
    expect(out.sources).toEqual([
      {
        name: "remoteok",
        status: "ok",
        fetched: 2,
        inserted: 2,
        updated: 0,
        unchanged: 0,
        copies: 0,
      },
    ]);
    expect(remoteok.mock.calls[0]![0].since).toEqual(hoursAgo(14 * 24));
    expect(remoteok.mock.calls[0]![0].userAgent).toBe("JobSearchOS/1.0 (+https://app.example.com)");
    expect(jobicy).not.toHaveBeenCalled();
    expect(deps.upsert).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.finish).toMatchObject({
      status: "ok",
      fetched: 2,
      inserted: 2,
      errorCode: null,
    });
  });

  it("el http_status de la fila sale de la última respuesta", async () => {
    const remoteok = vi.fn(async ({ fetchImpl }: { fetchImpl: typeof fetch }) => {
      await fetchImpl("https://example.com/api");
      return [job("a")];
    });
    const { deps, rows } = makeDeps();
    await runPoolFetch(
      {
        ...base,
        enabled: ["remoteok"],
        fetchImpl: (async () => new Response("[]", { status: 200 })) as unknown as typeof fetch,
        downloaders: downloaders({ remoteok }),
      },
      deps,
    );
    expect(rows[0]!.finish?.httpStatus).toBe(200);
  });

  it("una que falla no corta las demás y deja su error_code cerrado", async () => {
    const getonboard = vi.fn(async () => {
      throw new Error("Get on Board programming p1: HTTP 503");
    });
    const jobicy = vi.fn(async () => [job("c")]);
    const { deps, rows } = makeDeps();
    const out = await runPoolFetch(
      {
        ...base,
        enabled: ["getonboard", "jobicy"],
        downloaders: downloaders({ getonboard, jobicy }),
      },
      deps,
    );
    expect(out.sources[0]).toEqual({
      name: "getonboard",
      status: "error",
      fetched: 0,
      error: "http_5xx",
    });
    expect(out.sources[1]).toMatchObject({ name: "jobicy", status: "ok", fetched: 1 });
    expect(out.ok).toBe(true);
    expect(rows[0]!.finish).toMatchObject({ status: "error", errorCode: "http_5xx" });
    expect(rows[1]!.finish).toMatchObject({ status: "ok", errorCode: null });
  });

  it("todas fallan → ok false; el texto crudo del error no sale en el resultado", async () => {
    const leak = "Failed query: insert ... params: texto-de-aviso,user-uuid-123";
    const jobicy = vi.fn(async () => [job("c")]);
    const { deps } = makeDeps(
      {},
      {
        upsert: vi.fn(async () => {
          throw new Error(leak);
        }),
      },
    );
    const out = await runPoolFetch(
      { ...base, enabled: ["jobicy"], downloaders: downloaders({ jobicy }) },
      deps,
    );
    expect(out.ok).toBe(false);
    expect(out.sources[0]).toEqual({
      name: "jobicy",
      status: "error",
      fetched: 1,
      error: "unknown",
    });
    expect(JSON.stringify(out)).not.toContain("texto-de-aviso");
  });

  it("error_code para cada tipo de error de descarga", async () => {
    const cases: [string, string][] = [
      ["Jobicy: HTTP 429", "http_429"],
      ["Jobicy: HTTP 410", "http_4xx"],
      ["Jobicy: HTTP 500", "http_5xx"],
      ["Jobicy: respuesta inesperada", "parse"],
      ["algo raro", "unknown"],
    ];
    for (const [message, code] of cases) {
      const jobicy = vi.fn(async () => {
        throw new Error(message);
      });
      const { deps, rows } = makeDeps();
      const out = await runPoolFetch(
        { ...base, enabled: ["jobicy"], downloaders: downloaders({ jobicy }) },
        deps,
      );
      expect(out.sources[0]?.error).toBe(code);
      expect(rows[0]!.finish?.errorCode).toBe(code);
    }
  });

  it("un timeout de la descarga queda como timeout", async () => {
    const remoteok = vi.fn(({ fetchImpl }: { fetchImpl: typeof fetch }) =>
      fetchImpl("https://example.com/api").then(() => [job("a")]),
    );
    const { deps, rows } = makeDeps();
    const out = await runPoolFetch(
      {
        ...base,
        enabled: ["remoteok"],
        perSourceTimeoutMs: 20,
        fetchImpl: (() => new Promise<Response>(() => {})) as unknown as typeof fetch,
        downloaders: downloaders({ remoteok }),
      },
      deps,
    );
    expect(out.sources[0]).toMatchObject({ status: "error", error: "timeout" });
    expect(rows[0]!.finish?.errorCode).toBe("timeout");
    expect(deps.upsert).not.toHaveBeenCalled();
  });

  it("dentro del intervalo saltea, no descarga y no registra fila", async () => {
    const jobicy = vi.fn(async () => [job("c")]);
    const { deps, rows } = makeDeps({
      jobicy: { lastGoodStartedAt: hoursAgo(4), lastErrorCode: null },
    });
    const out = await runPoolFetch(
      { ...base, enabled: ["jobicy"], downloaders: downloaders({ jobicy }) },
      deps,
    );
    expect(out.sources).toEqual([
      { name: "jobicy", status: "skipped", fetched: 0, skipped: "intervalo" },
    ]);
    expect(jobicy).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
    expect(deps.recordStart).not.toHaveBeenCalled();
  });

  it("pasado el intervalo corre; Himalayas pide 23 h", async () => {
    const jobicy = vi.fn(async () => [job("c")]);
    const himalayas = vi.fn(async () => [job("h")]);
    const { deps } = makeDeps({
      jobicy: { lastGoodStartedAt: hoursAgo(5.5), lastErrorCode: null },
      himalayas: { lastGoodStartedAt: hoursAgo(22), lastErrorCode: null },
    });
    const out = await runPoolFetch(
      {
        ...base,
        enabled: ["jobicy", "himalayas"],
        downloaders: downloaders({ jobicy, himalayas }),
      },
      deps,
    );
    expect(out.sources.map((s) => [s.name, s.status, s.skipped])).toEqual([
      ["jobicy", "ok", undefined],
      ["himalayas", "skipped", "intervalo"],
    ]);
    expect(himalayas).not.toHaveBeenCalled();
  });

  it("si la última corrida terminó en 429 el intervalo se duplica", async () => {
    const jobicy = vi.fn(async () => [job("c")]);
    const hist = (h: number) => ({
      jobicy: { lastGoodStartedAt: hoursAgo(h), lastErrorCode: "http_429" },
    });
    const dentro = makeDeps(hist(7));
    const r1 = await runPoolFetch(
      { ...base, enabled: ["jobicy"], downloaders: downloaders({ jobicy }) },
      dentro.deps,
    );
    expect(r1.sources[0]).toMatchObject({ status: "skipped", skipped: "intervalo" });
    const fuera = makeDeps(hist(11));
    const r2 = await runPoolFetch(
      { ...base, enabled: ["jobicy"], downloaders: downloaders({ jobicy }) },
      fuera.deps,
    );
    expect(r2.sources[0]).toMatchObject({ status: "ok" });
  });

  it("force ignora el intervalo", async () => {
    const jobicy = vi.fn(async () => [job("c")]);
    const { deps } = makeDeps({ jobicy: { lastGoodStartedAt: hoursAgo(1), lastErrorCode: null } });
    // force ignora el intervalo pero igual lee el historial para la ventana
    const out = await runPoolFetch(
      { ...base, enabled: ["jobicy"], force: true, downloaders: downloaders({ jobicy }) },
      deps,
    );
    expect(out.sources[0]?.status).toBe("ok");
    expect(deps.lastFetches).toHaveBeenCalledTimes(1);
  });

  describe("ventana de descarga (backfill)", () => {
    const sinceOf = async (
      history: Partial<Record<PoolSourceName, PoolFetchHistory>>,
      extra: { backfillDays?: number; sinceHours?: number } = {},
    ) => {
      const remoteok = vi.fn(async (_a: { since: Date }) => [job("a")]);
      const { deps } = makeDeps(history);
      await runPoolFetch(
        { ...base, enabled: ["remoteok"], downloaders: downloaders({ remoteok }), ...extra },
        deps,
      );
      return remoteok.mock.calls[0]![0].since;
    };

    it("sin ninguna corrida ok: ahora menos los días de backfill", async () => {
      expect(await sinceOf({}, { backfillDays: 14 })).toEqual(hoursAgo(14 * 24));
      expect(await sinceOf({}, { backfillDays: 3 })).toEqual(hoursAgo(3 * 24));
    });

    it("con una ok: el inicio de la última ok menos 6 h de solapamiento", async () => {
      const since = await sinceOf({
        remoteok: {
          lastGoodStartedAt: hoursAgo(8),
          lastOkStartedAt: hoursAgo(8),
          lastErrorCode: null,
        },
      });
      expect(since).toEqual(hoursAgo(14));
    });

    it("la ventana nunca pasa de 30 días atrás aunque la última ok sea más vieja", async () => {
      const since = await sinceOf({
        remoteok: {
          lastGoodStartedAt: hoursAgo(40 * 24),
          lastOkStartedAt: hoursAgo(40 * 24),
          lastErrorCode: null,
        },
      });
      expect(since).toEqual(hoursAgo(30 * 24));
    });

    it("una partial no cuenta como ok: vuelve a hacer backfill", async () => {
      const since = await sinceOf({
        remoteok: { lastGoodStartedAt: hoursAgo(8), lastOkStartedAt: null, lastErrorCode: null },
      });
      expect(since).toEqual(hoursAgo(14 * 24));
    });

    it("sinceHours explícito pisa la regla", async () => {
      expect(await sinceOf({}, { sinceHours: 5 })).toEqual(hoursAgo(5));
    });

    it("lee POOL_BACKFILL_DAYS del entorno; inválido o mayor a 30 vuelve a 14 y avisa", async () => {
      const prev = process.env.POOL_BACKFILL_DAYS;
      try {
        process.env.POOL_BACKFILL_DAYS = "7";
        expect(await sinceOf({})).toEqual(hoursAgo(7 * 24));
        for (const bad of ["31", "0", "-2", "abc", "1.5"]) {
          process.env.POOL_BACKFILL_DAYS = bad;
          vi.mocked(logger.warn).mockClear();
          expect(await sinceOf({})).toEqual(hoursAgo(14 * 24));
          expect(logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ variable: "POOL_BACKFILL_DAYS" }),
            expect.any(String),
          );
        }
      } finally {
        if (prev === undefined) delete process.env.POOL_BACKFILL_DAYS;
        else process.env.POOL_BACKFILL_DAYS = prev;
      }
    });

    it("un backfill grande se recorta al tope de avisos por fuente y queda partial", async () => {
      const many = Array.from({ length: POOL_MAX_JOBS_PER_SOURCE + 500 }, (_, i) => job(`j${i}`));
      const remoteok = vi.fn(async () => many);
      const { deps } = makeDeps();
      const out = await runPoolFetch(
        { ...base, enabled: ["remoteok"], downloaders: downloaders({ remoteok }) },
        deps,
      );
      expect(vi.mocked(deps.upsert).mock.calls[0]![0]).toHaveLength(POOL_MAX_JOBS_PER_SOURCE);
      expect(out.sources[0]).toMatchObject({ status: "partial", truncated: true });
    });
  });

  it("parsePoolBackfillDays: default 14, entero 1 a 30", () => {
    expect(parsePoolBackfillDays(undefined)).toEqual({ days: 14, invalid: false });
    expect(parsePoolBackfillDays(" ")).toEqual({ days: 14, invalid: false });
    expect(parsePoolBackfillDays("30")).toEqual({ days: 30, invalid: false });
    expect(parsePoolBackfillDays("1")).toEqual({ days: 1, invalid: false });
    expect(parsePoolBackfillDays("31")).toEqual({ days: 14, invalid: true });
    expect(parsePoolBackfillDays("x")).toEqual({ days: 14, invalid: true });
  });

  it("el presupuesto corta la siguiente fuente", async () => {
    let t = 0;
    const remoteok = vi.fn(async () => {
      t += 50_000;
      return [job("a")];
    });
    const jobicy = vi.fn(async () => [job("c")]);
    const { deps, rows } = makeDeps();
    const out = await runPoolFetch(
      {
        ...base,
        enabled: ["remoteok", "jobicy"],
        budgetMs: 45_000,
        clock: () => t,
        downloaders: downloaders({ remoteok, jobicy }),
      },
      deps,
    );
    expect(out.sources[0]?.status).toBe("ok");
    expect(out.sources[1]).toEqual({
      name: "jobicy",
      status: "skipped",
      fetched: 0,
      skipped: "presupuesto",
    });
    expect(jobicy).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
  });

  it("errores del upsert → partial si algo se escribió; error si nada", async () => {
    const jobicy = vi.fn(async () => [job("a"), job("b")]);
    const parcial = makeDeps(
      {},
      { upsert: vi.fn(async () => summary(2, { inserted: 1, errors: 1 })) },
    );
    const r1 = await runPoolFetch(
      { ...base, enabled: ["jobicy"], downloaders: downloaders({ jobicy }) },
      parcial.deps,
    );
    expect(r1.sources[0]).toMatchObject({ status: "partial", inserted: 1, error: "unknown" });
    expect(parcial.rows[0]!.finish?.status).toBe("partial");
    const nada = makeDeps(
      {},
      { upsert: vi.fn(async () => summary(2, { inserted: 0, errors: 2 })) },
    );
    const r2 = await runPoolFetch(
      { ...base, enabled: ["jobicy"], downloaders: downloaders({ jobicy }) },
      nada.deps,
    );
    expect(r2.sources[0]).toMatchObject({ status: "error" });
  });

  it("recorta a POOL_MAX_JOBS_PER_SOURCE avisos y la fuente queda partial", async () => {
    expect(POOL_MAX_JOBS_PER_SOURCE).toBe(2000);
    const many = Array.from({ length: POOL_MAX_JOBS_PER_SOURCE + 5 }, (_, i) => job(`j${i}`));
    const jobicy = vi.fn(async () => many);
    const { deps, rows } = makeDeps();
    const out = await runPoolFetch(
      { ...base, enabled: ["jobicy"], downloaders: downloaders({ jobicy }) },
      deps,
    );
    expect(vi.mocked(deps.upsert).mock.calls[0]![0]).toHaveLength(POOL_MAX_JOBS_PER_SOURCE);
    expect(out.sources[0]).toMatchObject({ status: "partial", truncated: true });
    expect(rows[0]!.finish?.status).toBe("partial");
  });

  it("le pasa al upsert un shouldStop que mide el presupuesto total", async () => {
    let t = 0;
    const jobicy = vi.fn(async () => [job("a")]);
    const seen: boolean[] = [];
    const upsert = vi.fn(async (_raws: readonly RawJob[], opts: { shouldStop: () => boolean }) => {
      seen.push(opts.shouldStop());
      t += 50_000;
      seen.push(opts.shouldStop());
      return summary(1, { stopped: true });
    });
    const { deps, rows } = makeDeps({}, { upsert });
    const out = await runPoolFetch(
      {
        ...base,
        enabled: ["jobicy"],
        budgetMs: 45_000,
        clock: () => t,
        downloaders: downloaders({ jobicy }),
      },
      deps,
    );
    expect(seen).toEqual([false, true]);
    expect(out.sources[0]).toMatchObject({ status: "partial", stopped: true });
    expect(rows[0]!.finish?.status).toBe("partial");
  });

  it("descarga parcial (Get on Board cortó a la mitad): partial con el error_code", async () => {
    const getonboard = vi.fn(async () => ({ jobs: [job("a")], partialError: "timeout" as const }));
    const { deps, rows } = makeDeps();
    const out = await runPoolFetch(
      { ...base, enabled: ["getonboard"], downloaders: downloaders({ getonboard }) },
      deps,
    );
    expect(deps.upsert).toHaveBeenCalledTimes(1);
    expect(out.sources[0]).toMatchObject({ status: "partial", fetched: 1, error: "timeout" });
    expect(rows[0]!.finish).toMatchObject({ status: "partial", errorCode: "timeout" });
  });

  it("sin fuentes prendidas → ok y vacío", async () => {
    const { deps } = makeDeps();
    const out = await runPoolFetch({ ...base, enabled: [], downloaders: downloaders({}) }, deps);
    expect(out).toMatchObject({ ok: true, sources: [] });
  });
});

describe("runPoolFetch · fuentes ATS (boards de ats_boards)", () => {
  const board = (token: string) => ({
    id: `id-${token}`,
    token,
    region: null,
    companyName: `Empresa ${token}`,
  });
  const outcome = (token: string, status: PoolBoardOutcome["status"], fetched = 0) => ({
    id: `id-${token}`,
    token,
    status,
    fetched,
  });

  it("wwr y los ATS tienen su kind, 5 h de intervalo y están recomendados", () => {
    for (const n of ["wwr", "greenhouse", "lever", "ashby"] as const) {
      expect(POOL_SOURCE_KIND[n]).toBe(n);
      expect(POOL_MIN_INTERVAL_MS[n]).toBe(5 * 3_600_000);
      expect(POOL_RECOMMENDED_SOURCES).toContain(n);
    }
    expect(parsePoolSources("WWR, Greenhouse,lever,ashby").enabled).toEqual([
      "wwr",
      "greenhouse",
      "lever",
      "ashby",
    ]);
  });

  it("sin boards → skipped sin_boards, sin descargar ni registrar la corrida", async () => {
    const greenhouse = vi.fn();
    const { deps, rows } = makeDeps({}, { loadBoards: vi.fn(async () => []) });
    const out = await runPoolFetch(
      { ...base, enabled: ["greenhouse"], downloaders: downloaders({ greenhouse }) },
      deps,
    );
    expect(out.sources).toEqual([
      { name: "greenhouse", status: "skipped", fetched: 0, skipped: "sin_boards" },
    ]);
    expect(greenhouse).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
    expect(out.ok).toBe(true);
  });

  it("pasa los boards al descargador y actualiza solo los intentados, con código cerrado", async () => {
    const boards = [board("a"), board("b")];
    const lever = vi.fn(async (args: { boards?: readonly unknown[] }) => ({
      jobs: [job("1")],
      partialError: null,
      boards: [outcome("a", "ok", 1), outcome("b", "ok", 0)],
      args,
    }));
    const updateBoards = vi.fn(async () => {});
    const { deps } = makeDeps({}, { loadBoards: vi.fn(async () => boards), updateBoards });
    const out = await runPoolFetch(
      { ...base, enabled: ["lever"], downloaders: downloaders({ lever: lever as never }) },
      deps,
    );
    expect(deps.loadBoards).toHaveBeenCalledWith("lever");
    expect(lever.mock.calls[0]![0].boards).toEqual(boards);
    expect(updateBoards).toHaveBeenCalledWith(
      [
        { id: "id-a", status: "ok" },
        { id: "id-b", status: "ok" },
      ],
      expect.any(Date),
    );
    expect(out.sources[0]).toMatchObject({ name: "lever", status: "ok", fetched: 1 });
  });

  it("un board que falla deja la fuente partial, con su código, sin cortar a los demás", async () => {
    const ashby = vi.fn(async () => ({
      jobs: [job("1")],
      partialError: "http_4xx" as const,
      boards: [outcome("a", "not_found"), outcome("b", "ok", 1)],
    }));
    const updateBoards = vi.fn(async () => {});
    const { deps, rows } = makeDeps(
      {},
      { loadBoards: vi.fn(async () => [board("a"), board("b")]), updateBoards },
    );
    const out = await runPoolFetch(
      { ...base, enabled: ["ashby"], downloaders: downloaders({ ashby }) },
      deps,
    );
    expect(deps.upsert).toHaveBeenCalledTimes(1);
    expect(out.sources[0]).toMatchObject({ status: "partial", error: "http_4xx" });
    expect(rows[0]!.finish).toMatchObject({ status: "partial", errorCode: "http_4xx" });
    expect(updateBoards).toHaveBeenCalledWith(
      [
        { id: "id-a", status: "not_found" },
        { id: "id-b", status: "ok" },
      ],
      expect.any(Date),
    );
  });

  it("fallaron todos los boards → error", async () => {
    const greenhouse = vi.fn(async () => ({
      jobs: [],
      partialError: "timeout" as const,
      boards: [outcome("a", "timeout"), outcome("b", "http_5xx")],
    }));
    const { deps, rows } = makeDeps(
      {},
      { loadBoards: vi.fn(async () => [board("a"), board("b")]) },
    );
    const out = await runPoolFetch(
      { ...base, enabled: ["greenhouse"], downloaders: downloaders({ greenhouse }) },
      deps,
    );
    expect(out.sources[0]).toMatchObject({ status: "error", error: "timeout" });
    expect(rows[0]!.finish).toMatchObject({ status: "error", errorCode: "timeout" });
    expect(out.ok).toBe(false);
  });

  it("boards sin intentar por tiempo → partial con stopped; solo se actualizan los intentados", async () => {
    const greenhouse = vi.fn(async () => ({
      jobs: [],
      partialError: null,
      boards: [outcome("a", "ok")],
      stopped: true,
    }));
    const updateBoards = vi.fn(async () => {});
    const { deps } = makeDeps(
      {},
      { loadBoards: vi.fn(async () => [board("a"), board("b")]), updateBoards },
    );
    const out = await runPoolFetch(
      { ...base, enabled: ["greenhouse"], downloaders: downloaders({ greenhouse }) },
      deps,
    );
    expect(out.sources[0]).toMatchObject({ status: "partial", stopped: true });
    expect(updateBoards).toHaveBeenCalledWith([{ id: "id-a", status: "ok" }], expect.any(Date));
  });

  it("el log lleva token y conteos por board, no títulos", async () => {
    const info = vi.fn();
    const log = { info, warn: vi.fn(), error: vi.fn(), child: () => log } as unknown as Logger;
    const greenhouse = vi.fn(async () => ({
      jobs: [{ source: { externalId: "x" }, title: "Titulo Secreto" } as unknown as RawJob],
      boards: [outcome("a", "ok", 1)],
    }));
    const { deps } = makeDeps({}, { loadBoards: vi.fn(async () => [board("a")]) });
    await runPoolFetch(
      { ...base, logger: log, enabled: ["greenhouse"], downloaders: downloaders({ greenhouse }) },
      deps,
    );
    expect(info).toHaveBeenCalledWith(
      { source: "greenhouse", token: "a", status: "ok", jobs: 1 },
      "pool: board",
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain("Titulo Secreto");
  });

  it("shouldStop se activa al acercarse al tope de la fuente", async () => {
    let t = 0;
    const seen: boolean[] = [];
    const lever = vi.fn(async (args: { shouldStop?: () => boolean }) => {
      seen.push(args.shouldStop!());
      t = 29_000;
      seen.push(args.shouldStop!());
      return { jobs: [], boards: [outcome("a", "ok")] };
    });
    const { deps } = makeDeps({}, { loadBoards: vi.fn(async () => [board("a")]) });
    await runPoolFetch(
      {
        ...base,
        enabled: ["lever"],
        clock: () => t,
        downloaders: downloaders({ lever: lever as never }),
      },
      deps,
    );
    expect(seen).toEqual([false, true]);
  });
});

describe("atsDownloader", () => {
  const args = (boards: PoolBoard[], shouldStop?: () => boolean) => ({
    since: NOW,
    fetchImpl: vi.fn() as never,
    userAgent: "UA",
    boards,
    shouldStop,
  });
  const b = (token: string) => ({
    id: token,
    token,
    region: null,
    companyName: "Empresa Ficticia 1",
  });

  it("un board que lanza no corta a los demás y queda con su código cerrado", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/malo/")) return new Response("", { status: 403 });
      return new Response(JSON.stringify({ jobs: [] }));
    });
    const out = (await atsDownloader("greenhouse")({
      ...args([b("malo"), b("bueno")]),
      fetchImpl: fetchImpl as never,
    })) as Exclude<Awaited<ReturnType<ReturnType<typeof atsDownloader>>>, RawJob[]>;
    expect(out.boards).toEqual([
      { id: "malo", token: "malo", status: "http_4xx", fetched: 0 },
      { id: "bueno", token: "bueno", status: "ok", fetched: 0 },
    ]);
    expect(out.partialError).toBe("http_4xx");
  });

  it("se detiene cuando shouldStop lo pide y no toca los boards restantes", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ jobs: [] })));
    let calls = 0;
    const out = (await atsDownloader("ashby")({
      ...args([b("a"), b("b"), b("c")], () => calls++ >= 1),
      fetchImpl: fetchImpl as never,
    })) as Exclude<Awaited<ReturnType<ReturnType<typeof atsDownloader>>>, RawJob[]>;
    expect(out.boards).toHaveLength(1);
    expect(out.stopped).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sin boards no hace nada", async () => {
    const out = await atsDownloader("lever")(args([]));
    expect(out).toMatchObject({ jobs: [], boards: [], stopped: false });
  });

  it("not_found e invalid_token no cuentan como fallo de la fuente; los transitorios sí", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/roto/")) return new Response("", { status: 404 });
      if (url.includes("/lento/")) return new Response("", { status: 403 });
      return new Response(JSON.stringify({ jobs: [] }));
    });
    const run = async (boards: PoolBoard[]) =>
      (await atsDownloader("greenhouse")({
        ...args(boards),
        fetchImpl: fetchImpl as never,
      })) as Exclude<Awaited<ReturnType<ReturnType<typeof atsDownloader>>>, RawJob[]>;
    const soloRoto = await run([b("roto"), b("bueno")]);
    expect(soloRoto.boards?.map((o) => o.status)).toEqual(["not_found", "ok"]);
    expect(soloRoto.partialError).toBeNull();
    const malToken = await run([b("../x"), b("bueno")]);
    expect(malToken.boards?.[0]!.status).toBe("invalid_token");
    expect(malToken.partialError).toBeNull();
    const mixto = await run([b("roto"), b("lento")]);
    expect(mixto.partialError).toBe("http_4xx");
  });
});

describe("runPoolFetch · boards rotos, orden y updateBoards", () => {
  const brd = (token: string, over: Partial<PoolBoard> = {}): PoolBoard => ({
    id: `id-${token}`,
    token,
    region: null,
    companyName: `Empresa ${token}`,
    ...over,
  });

  it("si todos los boards son permanentes (not_found) la fuente queda ok", async () => {
    const lever = vi.fn(async () => ({
      jobs: [],
      partialError: null,
      boards: [{ id: "id-a", token: "a", status: "not_found" as const, fetched: 0 }],
    }));
    const { deps } = makeDeps({}, { loadBoards: vi.fn(async () => [brd("a")]) });
    const out = await runPoolFetch(
      { ...base, enabled: ["lever"], downloaders: downloaders({ lever: lever as never }) },
      deps,
    );
    expect(out.sources[0]).toMatchObject({ status: "ok" });
    expect(deps.updateBoards).toHaveBeenCalledWith(
      [{ id: "id-a", status: "not_found" }],
      expect.any(Date),
    );
  });

  it("un board not_found de hace menos de 24 h se saltea; de más de 24 h se reintenta", async () => {
    const lever = vi.fn(async () => ({ jobs: [], partialError: null, boards: [] }));
    const { deps } = makeDeps(
      {},
      {
        loadBoards: vi.fn(async () => [
          brd("reciente", { lastStatus: "not_found", lastFetchAt: hoursAgo(2) }),
          brd("viejo", { lastStatus: "not_found", lastFetchAt: hoursAgo(25) }),
          brd("sano", { lastStatus: "ok", lastFetchAt: hoursAgo(1) }),
          brd("nuevo", { lastStatus: null, lastFetchAt: null }),
        ]),
      },
    );
    await runPoolFetch(
      { ...base, enabled: ["lever"], downloaders: downloaders({ lever: lever as never }) },
      deps,
    );
    const passed = (lever.mock.calls[0] as unknown as [{ boards: PoolBoard[] }])[0].boards;
    expect(passed.map((x) => x.token)).toEqual(["viejo", "sano", "nuevo"]);
  });

  it("si solo quedan boards rotos recientes → skipped sin_boards", async () => {
    const lever = vi.fn();
    const { deps } = makeDeps(
      {},
      {
        loadBoards: vi.fn(async () => [
          brd("a", { lastStatus: "invalid_token", lastFetchAt: hoursAgo(3) }),
        ]),
      },
    );
    const out = await runPoolFetch(
      { ...base, enabled: ["lever"], downloaders: downloaders({ lever }) },
      deps,
    );
    expect(out.sources[0]).toMatchObject({ status: "skipped", skipped: "sin_boards" });
    expect(lever).not.toHaveBeenCalled();
  });

  it("updateBoards va después del upsert: si el upsert falla, last_fetch_at no avanza", async () => {
    const lever = vi.fn(async () => ({
      jobs: [job("1")],
      partialError: null,
      boards: [{ id: "id-a", token: "a", status: "ok" as const, fetched: 1 }],
    }));
    const order: string[] = [];
    const { deps } = makeDeps(
      {},
      {
        loadBoards: vi.fn(async () => [brd("a")]),
        upsert: vi.fn(async () => {
          order.push("upsert");
          throw new Error("db caída");
        }),
        updateBoards: vi.fn(async () => {
          order.push("update");
        }),
      },
    );
    const out = await runPoolFetch(
      { ...base, enabled: ["lever"], downloaders: downloaders({ lever: lever as never }) },
      deps,
    );
    expect(out.sources[0]).toMatchObject({ status: "error" });
    expect(order).toEqual(["upsert"]);

    const ok = makeDeps({}, { loadBoards: vi.fn(async () => [brd("a")]) });
    ok.deps.upsert = vi.fn(async (raws) => {
      order.push("upsert-ok");
      return summary(raws.length);
    });
    ok.deps.updateBoards = vi.fn(async () => {
      order.push("update-ok");
    });
    await runPoolFetch(
      { ...base, enabled: ["lever"], downloaders: downloaders({ lever: lever as never }) },
      ok.deps,
    );
    expect(order.slice(1)).toEqual(["upsert-ok", "update-ok"]);
  });

  it("corre primero la fuente con el intento más viejo (nunca intentada, antes que todas)", async () => {
    const called: string[] = [];
    const mk = (n: string) =>
      vi.fn(async () => {
        called.push(n);
        return [job(n)];
      });
    const { deps } = makeDeps(
      {},
      {
        lastAttempts: vi.fn(async () => ({
          remoteok: hoursAgo(1),
          jobicy: hoursAgo(9),
          getonboard: hoursAgo(5),
          himalayas: null,
        })),
      },
    );
    const out = await runPoolFetch(
      {
        ...base,
        enabled: ["getonboard", "remoteok", "jobicy", "himalayas"],
        downloaders: downloaders({
          getonboard: mk("getonboard"),
          remoteok: mk("remoteok"),
          jobicy: mk("jobicy"),
          himalayas: mk("himalayas"),
        }),
      },
      deps,
    );
    expect(called).toEqual(["himalayas", "jobicy", "getonboard", "remoteok"]);
    expect(out.sources.map((x) => x.name)).toEqual(called);
  });

  it("empate o sin historial conserva el orden configurado; si lastAttempts falla, también", async () => {
    const called: string[] = [];
    const mk = (n: string) =>
      vi.fn(async () => {
        called.push(n);
        return [job(n)];
      });
    const { deps } = makeDeps(
      {},
      {
        lastAttempts: vi.fn(async () => {
          throw new Error("x");
        }),
      },
    );
    await runPoolFetch(
      {
        ...base,
        enabled: ["remoteok", "jobicy"],
        downloaders: downloaders({ remoteok: mk("remoteok"), jobicy: mk("jobicy") }),
      },
      deps,
    );
    expect(called).toEqual(["remoteok", "jobicy"]);
  });

  it("sin presupuesto, las fuentes salteadas son las del final del orden (las más recientes)", async () => {
    let t = 0;
    const slow = vi.fn(async () => {
      t = 50_000;
      return [job("1")];
    });
    const { deps } = makeDeps(
      {},
      { lastAttempts: vi.fn(async () => ({ remoteok: hoursAgo(1), jobicy: hoursAgo(8) })) },
    );
    const out = await runPoolFetch(
      {
        ...base,
        enabled: ["remoteok", "jobicy"],
        budgetMs: 45_000,
        clock: () => t,
        downloaders: downloaders({ remoteok: vi.fn(), jobicy: slow }),
      },
      deps,
    );
    expect(out.sources.map((x) => [x.name, x.status])).toEqual([
      ["jobicy", "ok"],
      ["remoteok", "skipped"],
    ]);
  });
});
