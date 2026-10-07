import { describe, expect, it } from "vitest";
import sample from "./__fixtures__/remoteok-sample.json";
import { fetchRemoteOkJobs, isRemoteOkJob, mapRemoteOkJob, type RemoteOkItem } from "./remoteok";

const fixture = sample as unknown as RemoteOkItem[];
const [legal, full, noSalary, noLocation, old] = fixture as [
  RemoteOkItem,
  RemoteOkItem,
  RemoteOkItem,
  RemoteOkItem,
  RemoteOkItem,
];

const jsonFetch = (body: unknown, status = 200): typeof fetch =>
  (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

describe("Remote OK: contrato con una respuesta de ejemplo (formato a verificar)", () => {
  it("el primer elemento (legal) no es un aviso", () => {
    expect(isRemoteOkJob(legal)).toBe(false);
    expect(fixture.slice(1).every(isRemoteOkJob)).toBe(true);
  });

  it("mapea un aviso completo y worldwide", () => {
    const raw = mapRemoteOkJob(full);
    expect(raw.source).toEqual({
      kind: "other",
      name: "Remote OK",
      externalId: "remoteok:900001",
      url: "https://example.com/remote-jobs/900001",
      rawRef: null,
      original: { contentType: "application/json", body: expect.any(String) },
    });
    expect(raw.title).toBe("Senior Backend Engineer");
    expect(raw.companyRaw).toBe("Empresa A");
    expect(raw.modality).toBe("remoto");
    expect(raw.countriesAllowed).toEqual(["*"]);
    expect(raw.locationRaw).toBe("Remoto (Worldwide)");
    expect(raw.salaryMinUsd).toBe(90000);
    expect(raw.salaryMaxUsd).toBe(130000);
    expect(raw.salaryPeriod).toBe("anual");
    expect(raw.salaryNote).toContain("Remote OK");
    expect(raw.postedAt).toEqual(new Date(1789000000 * 1000));
    expect(raw.tags).toEqual(["python", "backend", "api"]);
    expect(raw.jdText).toContain("- Python y Postgres");
    expect(raw.jdText).toContain("Inglés & trabajo asincrónico");
    expect(raw.jdText).not.toMatch(/<[a-z]+>/i);
  });

  it("sin salario (0) → null y sin periodo; región restringida → countriesAllowed null", () => {
    const raw = mapRemoteOkJob(noSalary);
    expect(raw.salaryMinUsd).toBeNull();
    expect(raw.salaryMaxUsd).toBeNull();
    expect(raw.salaryPeriod).toBeNull();
    expect(raw.salaryNote).toBeNull();
    expect(raw.locationRaw).toBe("Remoto (USA)");
    expect(raw.countriesAllowed).toBeNull();
  });

  it("location vacío → países no especificados; salario con un solo extremo", () => {
    const raw = mapRemoteOkJob(noLocation);
    expect(raw.locationRaw).toBe("Remoto (países no especificados)");
    expect(raw.countriesAllowed).toBeNull();
    expect(raw.salaryMinUsd).toBe(70000);
    expect(raw.salaryMaxUsd).toBeNull();
    expect(raw.salaryPeriod).toBe("anual");
  });

  it("id numérico → externalId con prefijo", () => {
    expect(mapRemoteOkJob(old).source.externalId).toBe("remoteok:900004");
  });

  it("conserva el item crudo tal cual", () => {
    expect(JSON.parse(mapRemoteOkJob(full).source.original!.body)).toEqual(full);
  });
});

describe("fetchRemoteOkJobs (fetch inyectado)", () => {
  const since = new Date(1789000000 * 1000 - 1000);

  it("descarta el legal, filtra por fecha y deduplica", async () => {
    const r = await fetchRemoteOkJobs({
      since,
      fetchImpl: jsonFetch([...fixture, full]),
    });
    expect(r.seen).toBe(5);
    expect(r.skipped).toBe(0);
    expect(r.jobs.map((j) => j.source.externalId)).toEqual([
      "remoteok:900001",
      "remoteok:900002",
      "remoteok:900003",
    ]);
  });

  it("cuenta como skipped los avisos sin epoch válido o sin id/position", async () => {
    const r = await fetchRemoteOkJobs({
      since,
      fetchImpl: jsonFetch([
        legal,
        full,
        { ...full, id: "900010", epoch: undefined },
        { ...full, id: "900011", epoch: 0 },
        { slug: "sin-id" },
      ]),
    });
    expect(r.jobs).toHaveLength(1);
    expect(r.skipped).toBe(3);
  });

  it("filtra por tags sin distinguir mayúsculas", async () => {
    const r = await fetchRemoteOkJobs({
      since,
      tags: ["TypeScript"],
      fetchImpl: jsonFetch(fixture),
    });
    expect(r.jobs.map((j) => j.source.externalId)).toEqual(["remoteok:900002"]);
  });

  it("HTTP no-OK → error con fuente y status; cuerpo no array → error", async () => {
    await expect(fetchRemoteOkJobs({ since, fetchImpl: jsonFetch({}, 429) })).rejects.toThrow(
      /Remote OK: HTTP 429/,
    );
    await expect(fetchRemoteOkJobs({ since, fetchImpl: jsonFetch({ a: 1 }) })).rejects.toThrow(
      /no es un array/,
    );
  });
});
