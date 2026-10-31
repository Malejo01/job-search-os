import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fixtureData from "./__fixtures__/reliefweb-sample.json";
import {
  fetchReliefWebJobs,
  mapReliefWebJob,
  reliefwebUrl,
  type ReliefWebItem,
  type ReliefWebPage,
} from "./reliefweb";

const fixture = fixtureData as unknown as ReliefWebPage;
const [adminJob, legalJob, commsJob, logisticsJob, brokenJob] = fixture.data! as [
  ReliefWebItem,
  ReliefWebItem,
  ReliefWebItem,
  ReliefWebItem,
  ReliefWebItem,
];

describe("ReliefWeb: mapReliefWebJob", () => {
  it("mapea un aviso presencial institucional a RawJob", () => {
    const raw = mapReliefWebJob(adminJob);
    expect(raw).not.toBeNull();
    expect(raw!.source).toEqual({
      kind: "other",
      name: "ReliefWeb",
      externalId: "reliefweb:4098765",
      url: "https://reliefweb.int/job/4098765/finance-and-administration-officer",
      rawRef: null,
      original: { contentType: "application/json", body: expect.any(String) },
    });
    expect(raw!.title).toBe("Finance and Administration Officer");
    expect(raw!.companyRaw).toBe("United Nations High Commissioner for Refugees");
    expect(raw!.modality).toBe("presencial");
    expect(raw!.countriesAllowed).toEqual(["CO"]);
    expect(raw!.locationRaw).toBe("Colombia");
    expect(raw!.contractType).toBe("Staff");
    expect(raw!.categories).toEqual(["Administration/Finance"]);
    expect(raw!.tags).toEqual(["Administration/Finance"]);
    expect(raw!.postedAt).toEqual(new Date("2026-10-29T10:15:00.000Z"));
    expect(raw!.jdText).toContain("- 5+ years of experience in budgeting");
    expect(raw!.jdText).not.toMatch(/<[a-z]+>/i);
  });

  it("mapea un aviso remoto / home-based sin restringir países (countriesAllowed null)", () => {
    const raw = mapReliefWebJob(legalJob);
    expect(raw).not.toBeNull();
    expect(raw!.title).toBe("Legal and Protection Advisor (Home-based)");
    expect(raw!.companyRaw).toBe("Oxfam International");
    expect(raw!.modality).toBe("remoto");
    // No se asume restricción ciega al país de la oficina: deja null para prefiltro sin falso descarte H-1
    expect(raw!.countriesAllowed).toBeNull();
    expect(raw!.locationRaw).toContain("Remoto (home-based");
    expect(raw!.contractType).toBe("Consultancy");
    expect(raw!.categories).toEqual(["Protection/Human Rights"]);
  });

  it("mapea un puesto de comunicaciones en Argentina con código ISO", () => {
    const raw = mapReliefWebJob(commsJob);
    expect(raw).not.toBeNull();
    expect(raw!.title).toBe("Public Information and Media Specialist");
    expect(raw!.companyRaw).toBe("UNICEF");
    expect(raw!.modality).toBe("presencial");
    expect(raw!.countriesAllowed).toEqual(["AR"]);
    expect(raw!.locationRaw).toBe("Argentina");
    expect(raw!.categories).toEqual(["Advocacy/Communications"]);
  });

  it("mapea un puesto de logística y compras internacionales en Panamá", () => {
    const raw = mapReliefWebJob(logisticsJob);
    expect(raw).not.toBeNull();
    expect(raw!.title).toBe("Regional Procurement and Supply Chain Officer");
    expect(raw!.companyRaw).toBe("World Food Programme");
    expect(raw!.modality).toBe("presencial");
    expect(raw!.countriesAllowed).toEqual(["PA"]);
    expect(raw!.locationRaw).toBe("Panama");
    expect(raw!.categories).toEqual(["Logistics/Procurement"]);
  });

  it("falla cerrado ante aviso sin título o sin id", () => {
    expect(mapReliefWebJob(brokenJob)).toBeNull();
    expect(mapReliefWebJob({ ...adminJob, id: null })).toBeNull();
    expect(mapReliefWebJob({ ...adminJob, id: "" })).toBeNull();
    expect(mapReliefWebJob({ ...adminJob, fields: null })).toBeNull();
  });
});

describe("ReliefWeb: fetchReliefWebJobs", () => {
  const originalEnv = process.env.RELIEFWEB_APPNAME;

  beforeEach(() => {
    delete process.env.RELIEFWEB_APPNAME;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.RELIEFWEB_APPNAME = originalEnv;
    } else {
      delete process.env.RELIEFWEB_APPNAME;
    }
  });

  it("está APAGADO por defecto si no se pasa appname ni variable de entorno (0 llamadas de red)", async () => {
    let networkCalls = 0;
    const fakeFetch = (async () => {
      networkCalls++;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const result = await fetchReliefWebJobs({ fetchImpl: fakeFetch });
    expect(result).toEqual({
      jobs: [],
      pagesFetched: 0,
      seen: 0,
      skipped: 0,
      disabled: true,
    });
    expect(networkCalls).toBe(0);
  });

  it("se activa si se pasa appname en options o en variable de entorno", async () => {
    const fakeFetch = (async (url: string | URL | Request) => {
      expect(String(url)).toContain("appname=job-search-test");
      return new Response(JSON.stringify(fixture), { status: 200 });
    }) as typeof fetch;

    const result = await fetchReliefWebJobs({
      appname: "job-search-test",
      fetchImpl: fakeFetch,
    });

    expect(result.disabled).toBe(false);
    expect(result.pagesFetched).toBe(1);
    expect(result.seen).toBe(5);
    expect(result.skipped).toBe(1); // 1 aviso roto sin título
    expect(result.jobs).toHaveLength(4);
  });

  it("construye la URL con parámetros estructurados para API v2", () => {
    const urlStr = reliefwebUrl("https://api.reliefweb.int/v2/jobs", "job-search-os", 25, 50);
    const url = new URL(urlStr);
    expect(url.searchParams.get("appname")).toBe("job-search-os");
    expect(url.searchParams.get("profile")).toBe("full");
    expect(url.searchParams.get("limit")).toBe("25");
    expect(url.searchParams.get("offset")).toBe("50");
    expect(url.searchParams.getAll("fields[include][]")).toContain("title");
    expect(url.searchParams.getAll("fields[include][]")).toContain("body");
    expect(url.searchParams.getAll("fields[include][]")).toContain("career_categories");
  });

  it("filtra por fecha 'since', deduplica y corta paginación", async () => {
    const page1: ReliefWebPage = {
      totalCount: 3,
      count: 2,
      data: [adminJob, legalJob],
    };
    const page2: ReliefWebPage = {
      totalCount: 3,
      count: 1,
      data: [adminJob, logisticsJob], // adminJob repetido para probar dedup
    };

    let callCount = 0;
    const fakeFetch = (async (url: string | URL | Request) => {
      callCount++;
      const offset = new URL(String(url)).searchParams.get("offset");
      const pageData = offset === "0" ? page1 : page2;
      return new Response(JSON.stringify(pageData), { status: 200 });
    }) as typeof fetch;

    const result = await fetchReliefWebJobs({
      appname: "test-app",
      limit: 2,
      maxPages: 2,
      fetchImpl: fakeFetch,
    });

    expect(callCount).toBe(2);
    expect(result.pagesFetched).toBe(2);
    // adminJob, legalJob, logisticsJob (deduplicados por externalId)
    expect(result.jobs).toHaveLength(3);
  });

  it("envía header User-Agent solo si se especifica", async () => {
    const headersSent: (Record<string, string> | undefined)[] = [];
    const fakeFetch = (async (_url: unknown, init?: RequestInit) => {
      headersSent.push(init?.headers as Record<string, string>);
      return new Response(JSON.stringify({ totalCount: 0, count: 0, data: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await fetchReliefWebJobs({
      appname: "test-app",
      userAgent: "JobSearchOS/1.0",
      fetchImpl: fakeFetch,
    });

    await fetchReliefWebJobs({
      appname: "test-app",
      fetchImpl: fakeFetch,
    });

    expect(headersSent[0]?.["user-agent"]).toBe("JobSearchOS/1.0");
    expect(headersSent[1]?.["user-agent"]).toBeUndefined();
  });

  it("lanza error con status HTTP ante fallo de API", async () => {
    const failingFetch = (async () =>
      new Response("Rate limit exceeded", { status: 429 })) as unknown as typeof fetch;

    await expect(
      fetchReliefWebJobs({ appname: "test-app", fetchImpl: failingFetch }),
    ).rejects.toThrow(/ReliefWeb offset 0: HTTP 429/);
  });
});
