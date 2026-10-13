import { describe, expect, it, vi } from "vitest";
import { atsStatusOf } from "./ats-common";
import { fetchAshbyBoard } from "./ashby";

const board = { token: "empresa-ficticia", companyName: "Empresa Ficticia 3" };

const posting = (over: Record<string, unknown> = {}) => ({
  id: "bbbb-2222",
  title: "Product Designer",
  location: "Remote",
  secondaryLocations: [{ location: "LATAM" }],
  department: "Diseño",
  team: "Producto",
  isListed: true,
  isRemote: true,
  workplaceType: "Remote",
  employmentType: "FullTime",
  descriptionPlain: "Diseñas interfaces.",
  descriptionHtml: "<p>Diseñas interfaces.</p>",
  publishedAt: "2026-10-10T12:00:00.000+00:00",
  jobUrl: "https://jobs.example.test/empresa-ficticia/bbbb-2222",
  compensation: {
    summaryComponents: [
      {
        compensationType: "Salary",
        interval: "1 YEAR",
        currencyCode: "USD",
        minValue: 60000,
        maxValue: 80000,
      },
      { compensationType: "Equity", interval: "NONE" },
    ],
  },
  ...over,
});

const respond = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("fetchAshbyBoard", () => {
  it("mapea un aviso completo", async () => {
    const fetchImpl = respond({ jobs: [posting()] });
    const r = await fetchAshbyBoard({ ...board, fetchImpl });
    expect(r.jobs).toHaveLength(1);
    const j = r.jobs[0]!;
    expect(j.source).toMatchObject({
      kind: "ashby",
      externalId: "ashby:empresa-ficticia:bbbb-2222",
      url: "https://jobs.example.test/empresa-ficticia/bbbb-2222",
    });
    expect(j.companyRaw).toBe("Empresa Ficticia 3");
    expect(j.locationRaw).toBe("Remote; LATAM");
    expect(j.modality).toBe("remoto");
    expect(j.contractType).toBe("FullTime");
    expect(j.categories).toEqual(["Diseño", "Producto"]);
    expect(j.jdText).toBe("Diseñas interfaces.");
    expect(j.postedAt?.toISOString()).toBe("2026-10-10T12:00:00.000Z");
    expect(j).toMatchObject({
      salaryMinUsd: 60000,
      salaryMaxUsd: 80000,
      salaryPeriod: "anual",
      salaryNote: null,
    });
    expect((fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls[0]![0]).toBe(
      "https://api.ashbyhq.com/posting-api/job-board/empresa-ficticia?includeCompensation=true",
    );
  });

  it("descarta isListed === false y lo cuenta aparte", async () => {
    const r = await fetchAshbyBoard({
      ...board,
      fetchImpl: respond({ jobs: [posting({ id: "1", isListed: false }), posting({ id: "2" })] }),
    });
    expect(r.jobs.map((j) => j.source.externalId?.split(":")[2])).toEqual(["2"]);
    expect(r.unlisted).toBe(1);
    expect(r.filteredNonRemote).toBe(0);
  });

  it("descriptionHtml se pasa a texto si falta el plano", async () => {
    const r = await fetchAshbyBoard({
      ...board,
      fetchImpl: respond({
        jobs: [
          posting({
            descriptionPlain: undefined,
            descriptionHtml: "<p>Uno</p><ul><li>Dos</li></ul>",
          }),
        ],
      }),
    });
    expect(r.jobs[0]!.jdText).toBe("Uno\n- Dos");
  });

  it("filtra no remotos: isRemote, workplaceType y ubicación", async () => {
    const r = await fetchAshbyBoard({
      ...board,
      fetchImpl: respond({
        jobs: [
          posting({ id: "1" }),
          posting({
            id: "2",
            isRemote: false,
            workplaceType: "OnSite",
            location: "Paris",
            secondaryLocations: [],
          }),
          posting({
            id: "3",
            isRemote: false,
            workplaceType: "Hybrid",
            location: "Remote",
            secondaryLocations: [],
          }),
          posting({
            id: "4",
            isRemote: null,
            workplaceType: null,
            location: "Austin",
            secondaryLocations: [],
          }),
        ],
      }),
    });
    expect(r.jobs.map((j) => j.source.externalId?.split(":")[2])).toEqual(["1"]);
    expect(r.filteredNonRemote).toBe(3);
  });

  it("sueldo fuera de USD o con período raro va a la nota", async () => {
    const r = await fetchAshbyBoard({
      ...board,
      fetchImpl: respond({
        jobs: [
          posting({
            id: "1",
            compensation: {
              summaryComponents: [
                {
                  compensationType: "Salary",
                  interval: "1 YEAR",
                  currencyCode: "GBP",
                  minValue: 1,
                  maxValue: 2,
                },
              ],
            },
          }),
          posting({ id: "2", compensation: { compensationTierSummary: "Hasta 100 mil" } }),
        ],
      }),
    });
    expect(r.jobs[0]).toMatchObject({ salaryMinUsd: null, salaryPeriod: null });
    expect(r.jobs[0]!.salaryNote).toContain("GBP");
    expect(r.jobs[1]!.salaryNote).toContain("Hasta 100 mil");
  });

  it("100 ubicaciones secundarias: máximo 20 y el texto no pasa de 500 caracteres", async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      location: `Ciudad Ficticia Numero ${i} ${"x".repeat(40)}`,
    }));
    const r = await fetchAshbyBoard({
      ...board,
      fetchImpl: respond({ jobs: [posting({ secondaryLocations: many })] }),
    });
    const loc = r.jobs[0]!.locationRaw!;
    expect(loc.length).toBeLessThanOrEqual(500);
    expect(loc.split("; ").length).toBeLessThanOrEqual(21);
    expect(loc).not.toContain("Numero 20 ");
  });

  it("sin ventana de fecha: un aviso remoto de hace 90 días entra", async () => {
    const r = await fetchAshbyBoard({
      ...board,
      fetchImpl: respond({
        jobs: [posting({ id: "1", publishedAt: "2026-07-12T00:00:00Z" }), posting({ id: "2" })],
      }),
    });
    expect(r.jobs).toHaveLength(2);
    expect(r.truncated).toBe(0);
  });

  it("404 → not_found", async () => {
    const r = await fetchAshbyBoard({ ...board, fetchImpl: respond({}, 404) });
    expect(r.status).toBe("not_found");
  });

  it("429 con reintento", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobs: [posting()] })));
    const r = await fetchAshbyBoard({ ...board, fetchImpl, sleep: async () => {} });
    expect(r.jobs).toHaveLength(1);
  });

  it("token inválido: sin request", async () => {
    const fetchImpl = vi.fn();
    const e = await fetchAshbyBoard({
      ...board,
      token: "x/y",
      fetchImpl: fetchImpl as never,
    }).catch((x: unknown) => x);
    expect(atsStatusOf(e)).toBe("invalid_token");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
