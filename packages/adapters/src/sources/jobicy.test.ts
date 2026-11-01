import { describe, expect, it } from "vitest";
import sample from "./__fixtures__/jobicy-sample.json";
import {
  fetchJobicyJobs,
  JOBICY_BASE_URL,
  JOBICY_POOL_GEOS,
  JOBICY_POOL_INDUSTRIES,
  mapJobicyJob,
  parseJobicyDate,
  type JobicyItem,
} from "./jobicy";

const fixture = sample as unknown as { jobs: JobicyItem[] };
const [anywhere, country, region, noUrl, empty] = fixture.jobs as [
  JobicyItem,
  JobicyItem,
  JobicyItem,
  JobicyItem,
  JobicyItem,
];

const jsonFetch = (body: unknown, status = 200): typeof fetch =>
  (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

describe("Jobicy: contrato con una respuesta de ejemplo (formato a verificar)", () => {
  it("mapea un aviso 'Anywhere' con salario en USD", () => {
    const raw = mapJobicyJob(anywhere)!;
    expect(raw.source).toEqual({
      kind: "jobicy",
      name: "Jobicy",
      externalId: "880001",
      url: "https://jobicy.com/jobs/880001-ficticio",
      rawRef: null,
      original: { contentType: "application/json", body: expect.any(String) },
    });
    expect(raw.title).toBe("Senior Backend Engineer");
    expect(raw.companyRaw).toBe("Empresa Ficticia 1");
    expect(raw.modality).toBe("remoto");
    expect(raw.countriesAllowed).toEqual(["*"]);
    expect(raw.locationRaw).toBe("Remoto (Anywhere)");
    expect(raw.salaryMinUsd).toBe(50000);
    expect(raw.salaryMaxUsd).toBe(70000);
    expect(raw.salaryPeriod).toBe("anual");
    expect(raw.salaryNote).toBeNull();
    expect(raw.postedAt).toEqual(new Date("2026-10-10T12:00:00Z"));
    expect(raw.categories).toEqual(["engineering"]);
    expect(raw.contractType).toBe("Full-Time");
    expect(raw.seniority).toBe("Senior");
    expect(raw.tags).toEqual([]);
    expect(raw.jdText).toContain("- Python y Postgres");
    expect(raw.jdText).toContain("Inglés & trabajo asincrónico");
    expect(raw.jdText).not.toMatch(/<[a-z]+>/i);
  });

  it("conserva el aviso crudo y la URL canónica tal cual", () => {
    const raw = mapJobicyJob(anywhere)!;
    expect(JSON.parse(raw.source.original!.body)).toEqual(anywhere);
    expect(raw.source.url).toBe(anywhere.url);
  });

  it("un país → ISO; salario en otra moneda solo va en la nota (montos como string)", () => {
    const raw = mapJobicyJob(country)!;
    expect(raw.countriesAllowed).toEqual(["AR"]);
    expect(raw.locationRaw).toBe("Remoto (Argentina)");
    expect(raw.salaryMinUsd).toBeNull();
    expect(raw.salaryMaxUsd).toBeNull();
    expect(raw.salaryPeriod).toBeNull();
    expect(raw.salaryNote).toBe("EUR 40000–60000 por año según Jobicy");
    expect(raw.categories).toEqual(["design-creative"]);
  });

  it("pubDate 'YYYY-MM-DD HH:MM:SS' se toma como UTC", () => {
    expect(mapJobicyJob(country)!.postedAt).toEqual(new Date("2026-10-10T09:30:00Z"));
    expect(parseJobicyDate("2026-10-10 09:30:00")).toEqual(new Date("2026-10-10T09:30:00Z"));
    expect(parseJobicyDate("2026-10-10T09:30:00")).toEqual(new Date("2026-10-10T09:30:00Z"));
    expect(parseJobicyDate("2026-10-10T09:30:00+02:00")).toEqual(new Date("2026-10-10T07:30:00Z"));
  });

  it("pubDate inválida o ausente → null", () => {
    expect(parseJobicyDate("ayer")).toBeNull();
    expect(parseJobicyDate("")).toBeNull();
    expect(parseJobicyDate(undefined)).toBeNull();
    expect(mapJobicyJob({ ...anywhere, pubDate: "nunca" })!.postedAt).toBeNull();
  });

  it("una región no es un país: countriesAllowed null y la región queda en locationRaw", () => {
    const raw = mapJobicyJob(region)!;
    expect(raw.countriesAllowed).toBeNull();
    expect(raw.locationRaw).toBe("Remoto (Europe)");
    expect(raw.salaryNote).toBeNull();
    expect(raw.salaryPeriod).toBeNull();
    expect(raw.categories).toEqual(["customer-success"]);
    expect(raw.contractType).toBe("Full-Time");
  });

  it("jobGeo vacío, lista o nombre desconocido → null; nada se supone", () => {
    const vacio = mapJobicyJob(empty)!;
    expect(vacio.countriesAllowed).toBeNull();
    expect(vacio.locationRaw).toBe("Remoto (países no especificados)");
    expect(vacio.seniority).toBeNull();
    expect(mapJobicyJob({ ...anywhere, jobGeo: ["Chile", "Peru"] })!.countriesAllowed).toBeNull();
    expect(mapJobicyJob({ ...anywhere, jobGeo: "EU" })!.countriesAllowed).toBeNull();
    expect(mapJobicyJob({ ...anywhere, jobGeo: "Worldwide" })!.countriesAllowed).toEqual(["*"]);
  });

  it("varias industrias y tipos de contrato; salario sin moneda va en la nota", () => {
    const raw = mapJobicyJob(empty)!;
    expect(raw.categories).toEqual(["data-science", "business-analytics"]);
    expect(raw.contractType).toBe("Full-Time, Contract");
    expect(raw.salaryMinUsd).toBeNull();
    expect(raw.salaryNote).toBe("moneda no indicada 30000–? por año según Jobicy");
  });

  it("salario 0 o inválido → sin salario", () => {
    const raw = mapJobicyJob({
      ...anywhere,
      annualSalaryMin: 0,
      annualSalaryMax: "abc",
    })!;
    expect(raw.salaryMinUsd).toBeNull();
    expect(raw.salaryMaxUsd).toBeNull();
    expect(raw.salaryPeriod).toBeNull();
    expect(raw.salaryNote).toBeNull();
  });

  describe("sueldo: salaryMin/salaryMax/salaryPeriod y annualSalaryMin/annualSalaryMax", () => {
    const base = {
      ...anywhere,
      annualSalaryMin: undefined,
      annualSalaryMax: undefined,
      salaryCurrency: "USD",
    };

    it.each([
      ["year", "anual"],
      ["annual", "anual"],
      ["month", "mensual"],
      ["hour", "hora"],
      ["Hour", "hora"],
    ] as const)("USD con período %s → %s", (period, expected) => {
      const raw = mapJobicyJob({
        ...base,
        salaryMin: 4000,
        salaryMax: "5000",
        salaryPeriod: period,
      })!;
      expect(raw.salaryMinUsd).toBe(4000);
      expect(raw.salaryMaxUsd).toBe(5000);
      expect(raw.salaryPeriod).toBe(expected);
      expect(raw.salaryNote).toBeNull();
    });

    it("período desconocido o ausente → solo salaryNote", () => {
      for (const salaryPeriod of ["week", "", undefined]) {
        const raw = mapJobicyJob({ ...base, salaryMin: 111, salaryMax: 222, salaryPeriod })!;
        expect(raw.salaryMinUsd).toBeNull();
        expect(raw.salaryMaxUsd).toBeNull();
        expect(raw.salaryPeriod).toBeNull();
        expect(raw.salaryNote).toBe("USD 111–222 (período no indicado) según Jobicy");
      }
    });

    it("otra moneda con período claro → solo salaryNote, con el período", () => {
      const raw = mapJobicyJob({
        ...base,
        salaryCurrency: "EUR",
        salaryMin: 30,
        salaryPeriod: "hour",
      })!;
      expect(raw.salaryMinUsd).toBeNull();
      expect(raw.salaryNote).toBe("EUR 30–? por hora según Jobicy");
    });

    it("sin salaryMin/salaryMax usa la forma annual*; la primera forma gana si trae números", () => {
      const annual = mapJobicyJob({ ...base, annualSalaryMin: 50000, annualSalaryMax: 70000 })!;
      expect(annual.salaryPeriod).toBe("anual");
      expect(annual.salaryMinUsd).toBe(50000);
      const both = mapJobicyJob({
        ...base,
        salaryMin: 20,
        salaryMax: 30,
        salaryPeriod: "hour",
        annualSalaryMin: 50000,
        annualSalaryMax: 70000,
      })!;
      expect(both.salaryPeriod).toBe("hora");
      expect(both.salaryMinUsd).toBe(20);
    });
  });

  it("sin url, sin id o sin título → null (falla cerrado)", () => {
    expect(mapJobicyJob(noUrl)).toBeNull();
    expect(mapJobicyJob({ ...anywhere, id: undefined })).toBeNull();
    expect(mapJobicyJob({ ...anywhere, jobTitle: "  " })).toBeNull();
    expect(mapJobicyJob({ ...anywhere, url: "" })).toBeNull();
  });
});

describe("fetchJobicyJobs (fetch inyectado)", () => {
  const since = new Date("2026-10-09T00:00:00Z");

  it("llamadas por industria y geo en serie, filtra por fecha y deduplica por id", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(JSON.stringify(fixture));
    }) as unknown as typeof fetch;
    const r = await fetchJobicyJobs({ since, fetchImpl });

    const expectedUrls = [
      ...JOBICY_POOL_INDUSTRIES.map((ind) => `${JOBICY_BASE_URL}?count=200&industry=${ind}`),
      ...JOBICY_POOL_GEOS.map((geo) => `${JOBICY_BASE_URL}?count=200&geo=${geo}`),
    ];
    expect(urls).toEqual(expectedUrls);
    // Cada llamada procesó el fixture de 5 items (9 llamadas = 45 vistos en total)
    expect(r.seen).toBe(45);
    // 880004 no tiene url (skipped, 9 veces); 880005 es del 1/10 (fuera de la ventana)
    expect(r.skipped).toBe(9);
    // Deduplicados a solo los 3 válidos
    expect(r.jobs.map((j) => j.source.externalId)).toEqual(["880001", "880002", "880003"]);
    expect(r.byQuery).toBeDefined();
    expect(r.byQuery?.["industry=legal"]).toBe(5);
    expect(r.byQuery?.["geo=latam"]).toBe(5);
  });

  it("deduplica por id y combina categorías de distintas consultas", async () => {
    const itemA: JobicyItem = {
      ...anywhere,
      id: "990001",
      jobIndustry: ["Legal & Compliance"],
    };
    const itemB: JobicyItem = {
      ...anywhere,
      id: "990001",
      jobIndustry: ["Finance & Accounting"],
    };

    let callCount = 0;
    const fetchImpl = (async () => {
      callCount++;
      return new Response(JSON.stringify({ jobs: [callCount === 1 ? itemA : itemB] }));
    }) as unknown as typeof fetch;

    const r = await fetchJobicyJobs({
      since,
      industries: ["legal", "accounting-finance"],
      geos: [],
      fetchImpl,
    });

    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0]?.source.externalId).toBe("990001");
    expect(r.jobs[0]?.categories).toEqual(["legal-compliance", "finance-accounting"]);
  });

  it("respeta count, baseUrl e industrias customizadas", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ jobs: [anywhere, anywhere] }));
    }) as unknown as typeof fetch;
    const r = await fetchJobicyJobs({
      since,
      count: 50,
      baseUrl: "https://x.example/api",
      industries: ["marketing"],
      geos: [],
      fetchImpl,
    });
    expect(urls).toEqual(["https://x.example/api?count=50&industry=marketing"]);
    expect(r.jobs).toHaveLength(1);
    expect(r.seen).toBe(2);
  });

  it("un aviso con pubDate inválida no pasa el filtro y cuenta como skipped", async () => {
    const r = await fetchJobicyJobs({
      since,
      industries: ["legal"],
      geos: [],
      fetchImpl: jsonFetch({ jobs: [{ ...anywhere, pubDate: "nunca" }] }),
    });
    expect(r.jobs).toEqual([]);
    expect(r.skipped).toBe(1);
  });

  it("jobs que no es un array → error", async () => {
    await expect(
      fetchJobicyJobs({
        since,
        industries: ["legal"],
        geos: [],
        fetchImpl: jsonFetch({ jobs: {} }),
      }),
    ).rejects.toThrow("Jobicy: respuesta inesperada");
    await expect(
      fetchJobicyJobs({ since, industries: ["legal"], geos: [], fetchImpl: jsonFetch({}) }),
    ).rejects.toThrow("Jobicy: respuesta inesperada");
    await expect(
      fetchJobicyJobs({ since, industries: ["legal"], geos: [], fetchImpl: jsonFetch([]) }),
    ).rejects.toThrow("Jobicy: respuesta inesperada");
  });

  it("HTTP no-OK → error con la fuente y el status", async () => {
    await expect(
      fetchJobicyJobs({ since, industries: ["legal"], geos: [], fetchImpl: jsonFetch({}, 429) }),
    ).rejects.toThrow(/Jobicy: HTTP 429/);
  });

  it("manda user-agent solo si viene", async () => {
    const headers: (Record<string, string> | undefined)[] = [];
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      headers.push(init?.headers as Record<string, string>);
      return new Response(JSON.stringify({ jobs: [] }));
    }) as unknown as typeof fetch;
    await fetchJobicyJobs({
      since,
      industries: ["legal"],
      geos: [],
      userAgent: "JobSearchOS/1.0",
      fetchImpl,
    });
    await fetchJobicyJobs({ since, industries: ["legal"], geos: [], fetchImpl });
    expect(headers[0]?.["user-agent"]).toBe("JobSearchOS/1.0");
    expect(headers[1]?.["user-agent"]).toBeUndefined();
  });
});
