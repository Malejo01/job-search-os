import { ROLE_KEYS } from "@job-search-os/pipeline";
import { afterEach, describe, expect, it, vi } from "vitest";
import fixtureData from "./__fixtures__/jooble-sample.json";
import {
  fetchJoobleJobs,
  JOOBLE_DAILY_QUERY_CAP,
  JOOBLE_KEYWORDS_PER_ROLE,
  JOOBLE_QUERIES_PER_RUN,
  JOOBLE_WORST_CASE_DAILY_QUERIES,
  mapJoobleJob,
  parseJooblePage,
  planJoobleQueries,
  type JoobleItem,
} from "./jooble";

const fixture = fixtureData as unknown as { jobs: JoobleItem[] };
const [fullItem, sparseItem, noLinkItem] = fixture.jobs as [JoobleItem, JoobleItem, JoobleItem];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Jooble: mapJoobleJob", () => {
  it("mapea un item completo; el fragmento no es la descripción", () => {
    const raw = mapJoobleJob(fullItem)!;
    expect(raw.source).toMatchObject({
      kind: "other",
      name: "Jooble",
      externalId: "jooble:1001",
      url: "https://empleos.example.com/ver/1001",
    });
    expect(raw.title).toBe("Analista contable semi senior");
    expect(raw.companyRaw).toBe("Empresa A");
    expect(raw.locationRaw).toBe("Córdoba");
    expect(raw.contractType).toBe("Full-time");
    expect(raw.postedAt).toEqual(new Date("2026-11-16T09:30:00.000Z"));
    // Pendiente de descripción: el snippet no se usa como JD.
    expect(raw.jdText).toBeNull();
  });

  it("lo que la API no dice queda null, en particular countriesAllowed", () => {
    for (const item of [fullItem, sparseItem]) {
      const raw = mapJoobleJob(item)!;
      expect(raw.countriesAllowed).toBeNull();
      expect(raw.modality).toBe("desconocida");
      expect(raw.salaryMinUsd).toBeNull();
      expect(raw.salaryMaxUsd).toBeNull();
      expect(raw.salaryPeriod).toBeNull();
      expect(raw.lang).toBeNull();
    }
    const sparse = mapJoobleJob(sparseItem)!;
    expect(sparse.source.externalId).toBe("jooble:1002");
    expect(sparse.contractType).toBeNull();
    expect(sparse.postedAt).toBeNull();
    expect(sparse.salaryNote).toBe("a convenir");
  });

  it("descarta el item sin link http(s), sin título o sin id", () => {
    expect(mapJoobleJob(noLinkItem)).toBeNull();
    expect(mapJoobleJob({ ...fullItem, title: " " })).toBeNull();
    expect(mapJoobleJob({ ...fullItem, id: null })).toBeNull();
    expect(mapJoobleJob({ ...fullItem, link: null })).toBeNull();
  });
});

describe("Jooble: parseJooblePage (falla cerrado)", () => {
  it("acepta la forma esperada", () => {
    expect(parseJooblePage(fixtureData)).toHaveLength(3);
    expect(parseJooblePage({ totalCount: 0, jobs: [] })).toEqual([]);
  });

  it("descarta la página entera ante una forma inesperada", () => {
    expect(parseJooblePage(null)).toBeNull();
    expect(parseJooblePage([])).toBeNull();
    expect(parseJooblePage({ jobs: "x" })).toBeNull();
    expect(parseJooblePage({ resultados: [] })).toBeNull();
    expect(parseJooblePage({ jobs: [fullItem, 5] })).toBeNull();
    expect(parseJooblePage({ jobs: [fullItem, { ...fullItem, title: 42 }] })).toBeNull();
    expect(parseJooblePage({ jobs: [{ ...fullItem, id: { a: 1 } }] })).toBeNull();
  });
});

describe("Jooble: plan de consultas y tope diario", () => {
  it("el peor caso del día (corridas × consultas) no pasa de 100", () => {
    expect(JOOBLE_WORST_CASE_DAILY_QUERIES).toBeLessThanOrEqual(JOOBLE_DAILY_QUERY_CAP);
  });

  it("un plan nunca pasa del tope por corrida ni del diario, con cualquier pedido", () => {
    for (const maxQueries of [undefined, 0, 1, 15, 99, 100, 101, 5000, Number.MAX_SAFE_INTEGER]) {
      for (const rotation of [0, 1, 2, 7, 1000]) {
        const plan = planJoobleQueries({ maxQueries, rotation });
        expect(plan.length).toBeLessThanOrEqual(JOOBLE_DAILY_QUERY_CAP);
        if (maxQueries === undefined)
          expect(plan.length).toBeLessThanOrEqual(JOOBLE_QUERIES_PER_RUN);
      }
    }
  });

  it("usa las palabras de portal-guide, cubre todas las carreras rotando y no repite en una corrida", () => {
    const first = planJoobleQueries({ rotation: 0 });
    expect(first).toHaveLength(JOOBLE_QUERIES_PER_RUN);
    expect(new Set(first.map((q) => `${q.role}|${q.keywords}`)).size).toBe(first.length);
    expect(first[0]).toEqual({ role: "frontend", keywords: "desarrollador frontend" });

    const covered = new Set<string>();
    const runsToCover = Math.ceil((ROLE_KEYS.length * JOOBLE_KEYWORDS_PER_ROLE) / first.length);
    for (let r = 0; r < runsToCover; r++) {
      for (const q of planJoobleQueries({ rotation: r })) covered.add(q.role);
    }
    expect([...covered].sort()).toEqual([...ROLE_KEYS].sort());
  });

  it("sin carreras no hay consultas", () => {
    expect(planJoobleQueries({ roles: [] })).toEqual([]);
  });
});

describe("Jooble: fetchJoobleJobs", () => {
  it("sin clave no llama a la red ni devuelve ofertas", async () => {
    vi.stubEnv("JOOBLE_API_KEY", "");
    const fetchImpl = vi.fn();
    const r = await fetchJoobleJobs({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r).toMatchObject({ disabled: true, jobs: [], queriesMade: 0 });
  });

  it("con clave: una consulta POST por palabra, deduplica y salta lo inválido", async () => {
    const fetchImpl = vi.fn(async () => json(fixtureData));
    const r = await fetchJoobleJobs({
      apiKey: "clave-de-prueba",
      baseUrl: "https://api.example.com/jooble",
      queries: [
        { role: "finanzas_contabilidad", keywords: "contador" },
        { role: "asistencia_operaciones", keywords: "asistente administrativo" },
      ],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.com/jooble/clave-de-prueba");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      keywords: "contador",
      location: "Argentina",
      page: 1,
    });
    expect(r.queriesMade).toBe(2);
    expect(r.seen).toBe(6);
    expect(r.jobs.map((j) => j.source.externalId)).toEqual(["jooble:1001", "jooble:1002"]);
    expect(r.skipped).toBe(2);
    expect(r.disabled).toBe(false);
  });

  it("nunca hace más consultas que el tope, aunque le pasen un plan más largo", async () => {
    const fetchImpl = vi.fn(async () => json({ jobs: [] }));
    const queries = Array.from({ length: 500 }, (_, i) => ({ role: "qa", keywords: `q${i}` }));
    const r = await fetchJoobleJobs({
      apiKey: "clave-de-prueba",
      queries,
      maxQueries: 5000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(JOOBLE_DAILY_QUERY_CAP);
    expect(r.queriesMade).toBe(JOOBLE_DAILY_QUERY_CAP);
  });

  it("descarta entera la página de forma inesperada y sigue con la próxima", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ jobs: [fullItem, { ...sparseItem, title: 7 }] }))
      .mockResolvedValueOnce(json({ jobs: [fullItem] }));
    const r = await fetchJoobleJobs({
      apiKey: "clave-de-prueba",
      queries: [
        { role: "qa", keywords: "a" },
        { role: "qa", keywords: "b" },
      ],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.discardedPages).toBe(1);
    expect(r.jobs.map((j) => j.source.externalId)).toEqual(["jooble:1001"]);
  });

  it("un fallo de red corta la corrida con un código cerrado, conserva lo ya traído y no filtra la clave", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ jobs: [fullItem] }))
      .mockRejectedValueOnce(new Error("fetch failed https://x.example.com/api/clave-de-prueba"));
    const r = await fetchJoobleJobs({
      apiKey: "clave-de-prueba",
      queries: [
        { role: "qa", keywords: "a" },
        { role: "qa", keywords: "b" },
        { role: "qa", keywords: "c" },
      ],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(r.stoppedByError).toBe("unknown");
    expect(r.jobs).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain("clave-de-prueba");
  });

  it("se detiene ante un HTTP de error, sin exponer la URL con la clave", async () => {
    const fetchImpl = vi.fn(async () => json({}, 429));
    const r = await fetchJoobleJobs({
      apiKey: "clave-de-prueba",
      queries: [
        { role: "qa", keywords: "a" },
        { role: "qa", keywords: "b" },
      ],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r.stoppedByStatus).toBe(429);
    expect(JSON.stringify(r)).not.toContain("clave-de-prueba");
  });
});
