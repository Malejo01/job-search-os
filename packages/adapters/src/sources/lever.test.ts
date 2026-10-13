import { describe, expect, it, vi } from "vitest";
import { atsStatusOf } from "./ats-common";
import { fetchLeverBoard } from "./lever";

const board = { token: "empresa-ficticia", companyName: "Empresa Ficticia 2" };
const CREATED = Date.UTC(2026, 9, 10, 12, 0, 0);

const posting = (over: Record<string, unknown> = {}) => ({
  id: "aaaa-1111",
  text: "Data Engineer",
  hostedUrl: "https://jobs.example.test/empresa-ficticia/aaaa-1111",
  categories: { location: "Remote", team: "Datos", commitment: "Full-time" },
  workplaceType: "remote",
  createdAt: CREATED,
  descriptionPlain: "Armas pipelines.",
  lists: [{ text: "Requisitos", content: "<li>SQL</li><li>Python</li>" }],
  additionalPlain: "Beneficios varios.",
  salaryRange: { min: 4000, max: 6000, currency: "USD", interval: "per-month-salary" },
  ...over,
});

const respond = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("fetchLeverBoard", () => {
  it("mapea un aviso completo", async () => {
    const fetchImpl = respond([posting()]);
    const r = await fetchLeverBoard({ ...board, fetchImpl });
    expect(r.jobs).toHaveLength(1);
    const j = r.jobs[0]!;
    expect(j.source).toMatchObject({
      kind: "lever",
      externalId: "lever:empresa-ficticia:aaaa-1111",
      url: "https://jobs.example.test/empresa-ficticia/aaaa-1111",
    });
    expect(j.companyRaw).toBe("Empresa Ficticia 2");
    expect(j.title).toBe("Data Engineer");
    expect(j.modality).toBe("remoto");
    expect(j.contractType).toBe("Full-time");
    expect(j.categories).toEqual(["Datos"]);
    expect(j.postedAt?.getTime()).toBe(CREATED);
    expect(j.jdText).toBe("Armas pipelines.\n\nRequisitos\n- SQL\n- Python\n\nBeneficios varios.");
    expect(j).toMatchObject({
      salaryMinUsd: 4000,
      salaryMaxUsd: 6000,
      salaryPeriod: "mensual",
      salaryNote: null,
    });
    expect((fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls[0]![0]).toBe(
      "https://api.lever.co/v0/postings/empresa-ficticia?mode=json",
    );
  });

  it("region eu usa el host europeo", async () => {
    const fetchImpl = respond([]);
    await fetchLeverBoard({ ...board, region: "eu", fetchImpl });
    expect((fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls[0]![0]).toContain(
      "api.eu.lever.co",
    );
  });

  it("región inválida se rechaza antes de la request", async () => {
    const fetchImpl = vi.fn();
    const e = await fetchLeverBoard({
      ...board,
      region: "evil.example",
      fetchImpl: fetchImpl as never,
    }).catch((x: unknown) => x);
    expect(atsStatusOf(e)).toBe("invalid_token");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sueldo en otra moneda va a la nota", async () => {
    const r = await fetchLeverBoard({
      ...board,
      fetchImpl: respond([
        posting({
          salaryRange: { min: 50, max: 60, currency: "EUR", interval: "per-year-salary" },
        }),
      ]),
    });
    expect(r.jobs[0]).toMatchObject({ salaryMinUsd: null, salaryPeriod: null });
    expect(r.jobs[0]!.salaryNote).toContain("EUR");
  });

  it("filtra no remotos por workplaceType y ubicación", async () => {
    const r = await fetchLeverBoard({
      ...board,
      fetchImpl: respond([
        posting({ id: "1" }),
        posting({ id: "2", workplaceType: "hybrid", categories: { location: "Remote" } }),
        posting({ id: "3", workplaceType: "on-site", categories: { location: "Londres" } }),
        posting({ id: "4", workplaceType: "unspecified", categories: { location: "Berlin" } }),
        posting({ id: "5", workplaceType: "unspecified", categories: { location: "LATAM" } }),
      ]),
    });
    expect(r.jobs.map((j) => j.source.externalId?.split(":")[2])).toEqual(["1", "5"]);
    expect(r.filteredNonRemote).toBe(3);
  });

  it("sin ventana de fecha: un aviso remoto de hace 90 días entra", async () => {
    const r = await fetchLeverBoard({
      ...board,
      fetchImpl: respond([
        posting({ id: "viejo", createdAt: CREATED - 90 * 24 * 3_600_000 }),
        posting({ id: "nuevo" }),
      ]),
    });
    expect(r.jobs.map((j) => j.source.externalId?.split(":")[2])).toEqual(["viejo", "nuevo"]);
    expect(r.truncated).toBe(0);
  });

  it("100 ubicaciones: máximo 20 y el texto no pasa de 500 caracteres", async () => {
    const many = Array.from(
      { length: 100 },
      (_, i) => `Ciudad Ficticia Numero ${i} ${"x".repeat(40)}`,
    );
    const r = await fetchLeverBoard({
      ...board,
      fetchImpl: respond([posting({ categories: { location: "Remote", allLocations: many } })]),
    });
    const loc = r.jobs[0]!.locationRaw!;
    expect(loc.length).toBeLessThanOrEqual(500);
    expect(loc.split("; ").length).toBeLessThanOrEqual(21);
    expect(loc).not.toContain("Numero 20 ");
  });

  it("allLocations: location no remota pero otra ubicación sí → pasa el filtro", async () => {
    const r = await fetchLeverBoard({
      ...board,
      fetchImpl: respond([
        posting({
          id: "m1",
          workplaceType: "unspecified",
          categories: { location: "Berlin", allLocations: ["Berlin", "LATAM"] },
        }),
        posting({
          id: "m2",
          workplaceType: "unspecified",
          categories: { location: "Madrid", allLocations: ["Remote"] },
        }),
        posting({
          id: "m3",
          workplaceType: "unspecified",
          categories: { location: "Londres", allLocations: ["Londres", "Paris"] },
        }),
      ]),
    });
    expect(r.jobs.map((j) => j.source.externalId?.split(":")[2])).toEqual(["m1", "m2"]);
    expect(r.jobs[0]!.locationRaw).toBe("Berlin; LATAM");
    expect(r.filteredNonRemote).toBe(1);
  });

  it("404 → not_found", async () => {
    const r = await fetchLeverBoard({ ...board, fetchImpl: respond({}, 404) });
    expect(r.status).toBe("not_found");
  });

  it("5xx con reintento", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([posting()])));
    const r = await fetchLeverBoard({ ...board, fetchImpl, sleep: async () => {} });
    expect(r.jobs).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("token inválido: sin request", async () => {
    const fetchImpl = vi.fn();
    const e = await fetchLeverBoard({
      ...board,
      token: "a b",
      fetchImpl: fetchImpl as never,
    }).catch((x: unknown) => x);
    expect(atsStatusOf(e)).toBe("invalid_token");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("respuesta que no es array → parse", async () => {
    const e = await fetchLeverBoard({ ...board, fetchImpl: respond({ jobs: [] }) }).catch(
      (x: unknown) => x,
    );
    expect(atsStatusOf(e)).toBe("parse");
  });
});
