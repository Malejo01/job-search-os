import { afterEach, describe, expect, it, vi } from "vitest";
import fixtureData from "./__fixtures__/careerjet-sample.json";
import {
  CAREERJET_DAILY_QUERY_CAP,
  CAREERJET_QUERIES_PER_RUN,
  CAREERJET_WORST_CASE_DAILY_QUERIES,
  fetchCareerjetJobs,
  mapCareerjetJob,
  parseCareerjetPage,
  planCareerjetQueries,
  resolveCareerjetCaller,
  type CareerjetItem,
} from "./careerjet";

const fixture = fixtureData as unknown as { jobs: CareerjetItem[] };
const [fullItem, sparseItem, noLinkItem] = fixture.jobs as [
  CareerjetItem,
  CareerjetItem,
  CareerjetItem,
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Datos de quien llama, inventados: documentación (203.0.113.0/24) y un sitio de ejemplo. */
const caller = {
  affid: "afiliado-de-prueba",
  callerIp: "203.0.113.7",
  pageUrl: "https://sitio.example.com",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Careerjet: mapCareerjetJob", () => {
  it("mapea un item completo; el fragmento no es la descripción", () => {
    const raw = mapCareerjetJob(fullItem)!;
    expect(raw.source).toMatchObject({
      kind: "other",
      name: "Careerjet",
      url: "https://aviso.example.com/jobad/ficticio-0001",
    });
    expect(raw.source.externalId).toMatch(/^careerjet:[0-9a-f]{32}$/);
    expect(raw.title).toBe("Analista contable semi senior");
    expect(raw.companyRaw).toBe("Empresa A");
    expect(raw.locationRaw).toBe("Córdoba, Córdoba");
    expect(raw.postedAt).toEqual(new Date("2026-11-16T09:30:00.000Z"));
    // Pendiente de descripción: el fragmento no se usa como JD
    expect(raw.jdText).toBeNull();
    expect(raw.source.original).toMatchObject({ contentType: "application/json" });
  });

  it("el id es el de la API si lo trae; si no, un hash estable del link", () => {
    expect(mapCareerjetJob(sparseItem)!.source.externalId).toBe("careerjet:2002");
    const a = mapCareerjetJob(fullItem)!.source.externalId;
    expect(mapCareerjetJob({ ...fullItem })!.source.externalId).toBe(a);
    expect(
      mapCareerjetJob({ ...fullItem, url: "https://aviso.example.com/otro" })!.source.externalId,
    ).not.toBe(a);
  });

  it("lo que la API no dice queda null, en particular countriesAllowed", () => {
    for (const item of [fullItem, sparseItem]) {
      const raw = mapCareerjetJob(item)!;
      expect(raw.countriesAllowed).toBeNull();
      expect(raw.modality).toBe("desconocida");
      expect(raw.contractType).toBeNull();
      expect(raw.salaryMinUsd).toBeNull();
      expect(raw.salaryMaxUsd).toBeNull();
      expect(raw.salaryPeriod).toBeNull();
      expect(raw.lang).toBeNull();
    }
    const sparse = mapCareerjetJob(sparseItem)!;
    expect(sparse.companyRaw).toBe("desconocida");
    expect(sparse.postedAt).toBeNull();
    expect(sparse.salaryNote).toBe("a convenir");
  });

  it("descarta el item sin link http(s) o sin título", () => {
    expect(mapCareerjetJob(noLinkItem)).toBeNull();
    expect(mapCareerjetJob({ ...fullItem, title: " " })).toBeNull();
    expect(mapCareerjetJob({ ...fullItem, url: null })).toBeNull();
    expect(mapCareerjetJob({ ...fullItem, url: "ftp://aviso.example.com/x" })).toBeNull();
  });
});

describe("Careerjet: parseCareerjetPage (falla cerrado)", () => {
  it("acepta la forma esperada", () => {
    expect(parseCareerjetPage(fixtureData)).toHaveLength(3);
    expect(parseCareerjetPage({ jobs: [] })).toEqual([]);
  });

  it("descarta la página entera ante una forma inesperada", () => {
    expect(parseCareerjetPage(null)).toBeNull();
    expect(parseCareerjetPage([])).toBeNull();
    expect(parseCareerjetPage({ jobs: "x" })).toBeNull();
    // Respuestas de error o de ubicación ambigua no traen `jobs`
    expect(parseCareerjetPage({ type: "ERROR", error: "mensaje" })).toBeNull();
    expect(parseCareerjetPage({ type: "LOCATIONS", solveLocations: [] })).toBeNull();
    expect(parseCareerjetPage({ jobs: [fullItem, 5] })).toBeNull();
    expect(parseCareerjetPage({ jobs: [fullItem, { ...fullItem, title: 42 }] })).toBeNull();
    expect(parseCareerjetPage({ jobs: [{ ...fullItem, id: { a: 1 } }] })).toBeNull();
  });
});

describe("Careerjet: quien llama (el pool no tiene visitante)", () => {
  it("sin afiliado, sin IP válida o sin SITE_URL, queda apagada y dice por qué", () => {
    const env = {};
    expect(resolveCareerjetCaller({}, env)).toEqual({ ok: false, reason: "sin_affid" });
    expect(resolveCareerjetCaller({ affid: "a" }, env)).toEqual({ ok: false, reason: "sin_ip" });
    expect(resolveCareerjetCaller({ affid: "a", callerIp: "999.1.1.1" }, env)).toEqual({
      ok: false,
      reason: "sin_ip",
    });
    expect(resolveCareerjetCaller({ affid: "a", callerIp: "203.0.113.7" }, env)).toEqual({
      ok: false,
      reason: "sin_url",
    });
  });

  it("lee las variables CAREERJET_AFFID, CAREERJET_CALLER_IP y SITE_URL; la IP puede ser IPv6", () => {
    expect(
      resolveCareerjetCaller(
        {},
        {
          CAREERJET_AFFID: "afiliado-de-prueba",
          CAREERJET_CALLER_IP: "2001:db8::7",
          SITE_URL: "https://sitio.example.com/precios?x=1",
        },
      ),
    ).toEqual({
      ok: true,
      affid: "afiliado-de-prueba",
      callerIp: "2001:db8::7",
      pageUrl: "https://sitio.example.com",
    });
  });

  it("no hay valor por defecto: ni una IP ni un navegador inventados", async () => {
    vi.stubEnv("CAREERJET_AFFID", "afiliado-de-prueba");
    vi.stubEnv("CAREERJET_CALLER_IP", "");
    vi.stubEnv("SITE_URL", "https://sitio.example.com");
    const fetchImpl = vi.fn();
    const r = await fetchCareerjetJobs({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r).toMatchObject({ disabled: true, disabledReason: "sin_ip", jobs: [] });
  });
});

describe("Careerjet: plan de consultas y tope diario", () => {
  it("el peor caso del día (corridas × consultas) no pasa de 100", () => {
    expect(CAREERJET_WORST_CASE_DAILY_QUERIES).toBeLessThanOrEqual(CAREERJET_DAILY_QUERY_CAP);
  });

  it("un plan nunca pasa del tope por corrida ni del diario, con cualquier pedido", () => {
    for (const maxQueries of [undefined, 0, 1, 15, 99, 100, 101, 5000, Number.MAX_SAFE_INTEGER]) {
      for (const rotation of [0, 1, 7, 1000]) {
        const plan = planCareerjetQueries({ maxQueries, rotation });
        expect(plan.length).toBeLessThanOrEqual(CAREERJET_DAILY_QUERY_CAP);
        if (maxQueries === undefined)
          expect(plan.length).toBeLessThanOrEqual(CAREERJET_QUERIES_PER_RUN);
      }
    }
  });

  it("usa las palabras de portal-guide, en español, sin repetir en una corrida", () => {
    const plan = planCareerjetQueries({ rotation: 0 });
    expect(plan).toHaveLength(CAREERJET_QUERIES_PER_RUN);
    expect(new Set(plan.map((q) => `${q.role}|${q.keywords}`)).size).toBe(plan.length);
    expect(plan[0]).toEqual({ role: "frontend", keywords: "desarrollador frontend" });
  });
});

describe("Careerjet: fetchCareerjetJobs", () => {
  it("sin afiliado no llama a la red ni devuelve ofertas", async () => {
    vi.stubEnv("CAREERJET_AFFID", "");
    const fetchImpl = vi.fn();
    const r = await fetchCareerjetJobs({
      callerIp: caller.callerIp,
      pageUrl: caller.pageUrl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r).toMatchObject({
      disabled: true,
      disabledReason: "sin_affid",
      jobs: [],
      queriesMade: 0,
    });
  });

  it("con todo: un GET por palabra con es_AR, la IP del servidor y su User-Agent; deduplica y salta lo inválido", async () => {
    const fetchImpl = vi.fn(async () => json(fixtureData));
    const r = await fetchCareerjetJobs({
      ...caller,
      baseUrl: "https://api.example.com/careerjet",
      userAgent: "UA-de-prueba/1",
      queries: [
        { role: "finanzas_contabilidad", keywords: "contador" },
        { role: "asistencia_operaciones", keywords: "asistente administrativo" },
      ],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://api.example.com/careerjet");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      locale_code: "es_AR",
      keywords: "contador",
      location: "Argentina",
      page: "1",
      affid: "afiliado-de-prueba",
      user_ip: "203.0.113.7",
      user_agent: "UA-de-prueba/1",
      url: "https://sitio.example.com",
    });
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({ "user-agent": "UA-de-prueba/1" });
    expect(r.queriesMade).toBe(2);
    expect(r.seen).toBe(6);
    expect(r.jobs).toHaveLength(2);
    expect(r.skipped).toBe(2);
    expect(r.disabled).toBe(false);
  });

  it("nunca hace más consultas que el tope, aunque le pasen un plan más largo", async () => {
    const fetchImpl = vi.fn(async () => json({ jobs: [] }));
    const queries = Array.from({ length: 500 }, (_, i) => ({ role: "qa", keywords: `q${i}` }));
    const r = await fetchCareerjetJobs({
      ...caller,
      queries,
      maxQueries: 5000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(CAREERJET_DAILY_QUERY_CAP);
    expect(r.queriesMade).toBe(CAREERJET_DAILY_QUERY_CAP);
  });

  it("descarta entera la página de forma inesperada y sigue con la próxima", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ jobs: [fullItem, { ...sparseItem, title: 7 }] }))
      .mockResolvedValueOnce(json({ type: "ERROR" }))
      .mockResolvedValueOnce(json({ jobs: [fullItem] }));
    const r = await fetchCareerjetJobs({
      ...caller,
      queries: [
        { role: "qa", keywords: "a" },
        { role: "qa", keywords: "b" },
        { role: "qa", keywords: "c" },
      ],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.discardedPages).toBe(2);
    expect(r.jobs).toHaveLength(1);
  });

  it("un fallo de red corta la corrida con un código cerrado y no filtra el afiliado", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ jobs: [fullItem] }))
      .mockRejectedValueOnce(
        new Error("fetch failed https://x.example.com/search?affid=afiliado-de-prueba"),
      );
    const r = await fetchCareerjetJobs({
      ...caller,
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
    expect(JSON.stringify(r)).not.toContain("afiliado-de-prueba");
  });

  it("se detiene ante un HTTP de error, sin exponer la URL con el afiliado", async () => {
    const fetchImpl = vi.fn(async () => json({}, 429));
    const r = await fetchCareerjetJobs({
      ...caller,
      queries: [
        { role: "qa", keywords: "a" },
        { role: "qa", keywords: "b" },
      ],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r.stoppedByStatus).toBe(429);
    expect(JSON.stringify(r)).not.toContain("afiliado-de-prueba");
  });
});
