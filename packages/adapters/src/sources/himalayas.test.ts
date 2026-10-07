import { describe, expect, it } from "vitest";
import page from "./__fixtures__/himalayas-page.json";
import {
  fetchHimalayasJobs,
  himalayasUrl,
  mapHimalayasJob,
  type HimalayasJobItem,
  type HimalayasPage,
} from "./himalayas";

const fixture = page as unknown as HimalayasPage;
const [full, worldwide, unrestricted, eur, broken] = fixture.jobs! as [
  HimalayasJobItem,
  HimalayasJobItem,
  HimalayasJobItem,
  HimalayasJobItem,
  HimalayasJobItem,
];

describe("Himalayas: contrato con una respuesta de ejemplo (formato a verificar)", () => {
  it("mapea un aviso completo a RawJob", () => {
    const raw = mapHimalayasJob(full)!;
    expect(raw.source).toEqual({
      kind: "other",
      name: "Himalayas",
      externalId: `himalayas:${full.guid}`,
      url: full.applicationLink,
      rawRef: null,
      original: { contentType: "application/json", body: expect.any(String) },
    });
    expect(raw.title).toBe("Senior Backend Engineer");
    expect(raw.companyRaw).toBe("Empresa X");
    expect(raw.modality).toBe("remoto");
    expect(raw.countriesAllowed).toEqual(["AR", "CL", "UY"]);
    expect(raw.locationRaw).toBe("Remoto (Argentina, Chile, Uruguay)");
    // Período sin verificar: los montos van solo en la nota
    expect(raw.salaryMinUsd).toBeNull();
    expect(raw.salaryMaxUsd).toBeNull();
    expect(raw.salaryPeriod).toBeNull();
    expect(raw.salaryNote).toBe(`USD ${full.minSalary}–${full.maxSalary}, período a verificar`);
    expect(raw.contractType).toBe("Full Time");
    expect(raw.seniority).toBe("Senior");
    expect(raw.tags).toEqual(["Software-Engineering", "Backend"]);
    expect(raw.postedAt).toEqual(new Date(1790000000 * 1000));
    expect(raw.jdText).toContain("- 5+ años con APIs");
    expect(raw.jdText).toContain("Inglés & español");
    expect(raw.jdText).not.toMatch(/<[a-z]+>/i);
  });

  it("conserva el payload original tal cual", () => {
    expect(JSON.parse(mapHimalayasJob(full)!.source.original!.body)).toEqual(full);
  });

  it("sin salario → todo null", () => {
    const raw = mapHimalayasJob(worldwide)!;
    expect(raw.salaryMinUsd).toBeNull();
    expect(raw.salaryMaxUsd).toBeNull();
    expect(raw.salaryPeriod).toBeNull();
    expect(raw.salaryNote).toBeNull();
  });

  it("'Worldwide' explícito → ['*']", () => {
    expect(mapHimalayasJob(worldwide)!.countriesAllowed).toEqual(["*"]);
  });

  it("sin restricciones → null (no se asume worldwide)", () => {
    const raw = mapHimalayasJob(unrestricted)!;
    expect(raw.countriesAllowed).toBeNull();
    expect(raw.locationRaw).toBe("Remoto (sin restricción de país indicada)");
    expect(raw.seniority).toBe("Senior, Lead");
  });

  it("otra moneda → salaryNote, sin montos en USD", () => {
    const raw = mapHimalayasJob(eur)!;
    expect(raw.salaryMinUsd).toBeNull();
    expect(raw.salaryMaxUsd).toBeNull();
    expect(raw.salaryPeriod).toBeNull();
    expect(raw.salaryNote).toContain("EUR 60000–80000");
  });

  it("región que no es un país → countriesAllowed null, la región queda en locationRaw", () => {
    const raw = mapHimalayasJob(eur)!;
    expect(raw.countriesAllowed).toBeNull();
    expect(raw.locationRaw).toBe("Remoto (Europe)");
  });

  it("sin guid o sin título → null (falla cerrado)", () => {
    expect(mapHimalayasJob(broken)).toBeNull();
    expect(mapHimalayasJob({ ...full, guid: undefined })).toBeNull();
  });
});

describe("fetchHimalayasJobs (fetch inyectado)", () => {
  const now = 1_790_000_000;
  const item = (guid: string, pubDate: number): HimalayasJobItem => ({
    ...full,
    guid,
    pubDate,
  });
  const fakeFetch = (pages: HimalayasPage[], calls: string[] = []): typeof fetch =>
    (async (url: string | URL | Request) => {
      const u = String(url);
      calls.push(u);
      const offset = Number(/[?&]offset=(\d+)/.exec(u)![1]);
      const body = pages.find((p) => p.offset === offset) ?? { jobs: [], offset };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;

  it("pagina por offset, filtra por fecha y deduplica", async () => {
    const calls: string[] = [];
    const pages: HimalayasPage[] = [
      { offset: 0, totalCount: 5, jobs: [item("a", now - 10), item("b", now - 20)] },
      { offset: 2, totalCount: 5, jobs: [item("a", now - 10), item("old", now - 900_000)] },
      { offset: 4, totalCount: 5, jobs: [item("c", now - 30)] },
    ];
    const r = await fetchHimalayasJobs({
      since: new Date((now - 86_400) * 1000),
      limit: 2,
      fetchImpl: fakeFetch(pages, calls),
    });
    expect(calls).toHaveLength(3);
    expect(calls[1]).toBe(himalayasUrl("https://himalayas.app/jobs/api", 2, 2));
    expect(r.pagesFetched).toBe(3);
    expect(r.seen).toBe(5);
    expect(r.jobs.map((j) => j.source.externalId)).toEqual([
      "himalayas:a",
      "himalayas:b",
      "himalayas:c",
    ]);
  });

  it("corta cuando una página entera es más vieja que la ventana", async () => {
    const pages: HimalayasPage[] = [
      { offset: 0, totalCount: 100, jobs: [item("o1", now - 900_000), item("o2", now - 950_000)] },
      { offset: 2, totalCount: 100, jobs: [item("x", now)] },
    ];
    const r = await fetchHimalayasJobs({
      since: new Date((now - 86_400) * 1000),
      limit: 2,
      fetchImpl: fakeFetch(pages),
    });
    expect(r.pagesFetched).toBe(1);
    expect(r.jobs).toEqual([]);
  });

  it("respeta maxPages y cuenta los avisos rotos", async () => {
    const pages: HimalayasPage[] = [
      { offset: 0, totalCount: 100, jobs: [item("a", now), { ...broken, pubDate: now }] },
      { offset: 2, totalCount: 100, jobs: [item("b", now)] },
      { offset: 3, totalCount: 100, jobs: [item("c", now)] },
    ];
    const r = await fetchHimalayasJobs({
      since: new Date(0),
      limit: 2,
      maxPages: 2,
      fetchImpl: fakeFetch(pages),
    });
    expect(r.pagesFetched).toBe(2);
    expect(r.skipped).toBe(1);
    expect(r.jobs.map((j) => j.source.externalId)).toEqual(["himalayas:a", "himalayas:b"]);
  });

  it("HTTP no-OK → error con la fuente y el status", async () => {
    const failing = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    await expect(fetchHimalayasJobs({ since: new Date(0), fetchImpl: failing })).rejects.toThrow(
      /Himalayas.*HTTP 503/,
    );
  });
});
