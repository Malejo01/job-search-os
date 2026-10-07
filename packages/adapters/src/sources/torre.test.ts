import { describe, expect, it } from "vitest";
import page from "./__fixtures__/torre-search-page.json";
import {
  fetchTorreJobs,
  mapTorreJob,
  torreUrl,
  TORRE_DEFAULT_FILTERS,
  type TorrePage,
  type TorreResult,
} from "./torre";

const fixture = page as unknown as TorrePage;
const [full, partial, eur, unrestricted, hybrid, broken] = fixture.results! as [
  TorreResult,
  TorreResult,
  TorreResult,
  TorreResult,
  TorreResult,
  TorreResult,
];

describe("Torre: contrato con un resultado de ejemplo (formato a verificar)", () => {
  it("mapea un resultado completo a RawJob", () => {
    const raw = mapTorreJob(full)!;
    expect(raw.source).toEqual({
      kind: "other",
      name: "Torre",
      externalId: "torre:aB3dE5fG",
      url: "https://torre.ai/post/aB3dE5fG",
      rawRef: null,
      original: { contentType: "application/json", body: expect.any(String) },
    });
    expect(raw.title).toBe("Full Stack Developer");
    expect(raw.companyRaw).toBe("Empresa X");
    expect(raw.modality).toBe("remoto");
    expect(raw.countriesAllowed).toEqual(["*"]);
    expect(raw.salaryMinUsd).toBe(3000);
    expect(raw.salaryMaxUsd).toBe(4500);
    expect(raw.salaryPeriod).toBe("mensual");
    expect(raw.tags).toEqual(["TypeScript", "React"]);
    expect(raw.postedAt).toEqual(new Date("2026-10-05T12:00:00.000Z"));
    expect(raw.jdText).toContain("- React");
    expect(JSON.parse(raw.source.original!.body)).toEqual(full);
  });

  it("sin descripción → jdText null (pendiente_jd); sin compensación → salario null", () => {
    const raw = mapTorreJob(partial)!;
    expect(raw.jdText).toBeNull();
    expect(raw.salaryMinUsd).toBeNull();
    expect(raw.salaryNote).toBeNull();
    expect(raw.salaryPeriod).toBeNull();
  });

  it("ubicación de sede no es restricción: countriesAllowed null", () => {
    const raw = mapTorreJob(partial)!;
    expect(raw.locationRaw).toBe("Remoto (Buenos Aires, Argentina)");
    expect(raw.countriesAllowed).toBeNull();
  });

  it("sin ubicaciones → null, no se asume worldwide", () => {
    const raw = mapTorreJob(unrestricted)!;
    expect(raw.locationRaw).toBe("Remoto");
    expect(raw.countriesAllowed).toBeNull();
  });

  it("otra moneda → salaryNote con moneda y montos, sin USD", () => {
    const raw = mapTorreJob(eur)!;
    expect(raw.salaryMinUsd).toBeNull();
    expect(raw.salaryMaxUsd).toBeNull();
    expect(raw.salaryNote).toContain("EUR 2000–2800 monthly");
  });

  it("remote false: híbrido solo si lo dice, si no desconocida", () => {
    expect(mapTorreJob(hybrid)!.modality).toBe("hibrido");
    expect(mapTorreJob({ ...hybrid, locations: ["Lima, Peru"] })!.modality).toBe("desconocida");
    expect(mapTorreJob({ ...hybrid, locations: ["On-site Lima"] })!.modality).toBe("presencial");
  });

  it("sin id u objective → null (falla cerrado)", () => {
    expect(mapTorreJob(broken)).toBeNull();
    expect(mapTorreJob({ ...full, objective: "  " })).toBeNull();
  });
});

describe("fetchTorreJobs (fetch inyectado)", () => {
  const result = (id: string, created: string): TorreResult => ({ ...full, id, created });
  const fakeFetch = (
    pages: TorrePage[],
    calls: { url: string; init?: RequestInit }[] = [],
  ): typeof fetch =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, init });
      const offset = Number(/[?&]offset=(\d+)/.exec(u)![1]);
      const body = pages.find((p) => p.offset === offset) ?? { results: [], offset };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;

  const recent = "2026-10-05T00:00:00.000Z";
  const old = "2026-01-01T00:00:00.000Z";
  const since = new Date("2026-10-01T00:00:00.000Z");

  it("hace POST con el body de filtros, pagina por offset y salta los rotos", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const pages: TorrePage[] = [
      { offset: 0, total: 3, results: [result("a", recent), broken] },
      { offset: 2, total: 3, results: [result("b", recent)] },
    ];
    const r = await fetchTorreJobs({ since, size: 2, fetchImpl: fakeFetch(pages, calls) });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.init?.method).toBe("POST");
    expect(calls[0]!.init?.body).toBe(JSON.stringify(TORRE_DEFAULT_FILTERS));
    expect(calls[1]!.url).toBe(torreUrl("https://search.torre.co/opportunities/_search/", 2, 2));
    expect(r.skipped).toBe(1);
    expect(r.seen).toBe(3);
    expect(r.jobs.map((j) => j.source.externalId)).toEqual(["torre:a", "torre:b"]);
  });

  it("corta cuando una página entera es más vieja que la ventana", async () => {
    const pages: TorrePage[] = [
      { offset: 0, total: 100, results: [result("o1", old), result("o2", old)] },
      { offset: 2, total: 100, results: [result("x", recent)] },
    ];
    const r = await fetchTorreJobs({ since, size: 2, fetchImpl: fakeFetch(pages) });
    expect(r.pagesFetched).toBe(1);
    expect(r.jobs).toEqual([]);
  });

  it("respeta maxPages", async () => {
    const pages: TorrePage[] = [
      { offset: 0, total: 100, results: [result("a", recent)] },
      { offset: 1, total: 100, results: [result("b", recent)] },
      { offset: 2, total: 100, results: [result("c", recent)] },
    ];
    const r = await fetchTorreJobs({ since, size: 1, maxPages: 2, fetchImpl: fakeFetch(pages) });
    expect(r.pagesFetched).toBe(2);
    expect(r.jobs).toHaveLength(2);
  });

  it("HTTP no-OK → error con la fuente y el status", async () => {
    const failing = (async () => new Response("nope", { status: 429 })) as unknown as typeof fetch;
    await expect(fetchTorreJobs({ since, fetchImpl: failing })).rejects.toThrow(/Torre.*HTTP 429/);
  });
});
