import { describe, expect, it, vi } from "vitest";
import { atsStatusOf } from "./ats-common";
import { fetchGreenhouseBoard } from "./greenhouse";

const SINCE = new Date("2026-10-01T00:00:00Z");
const board = { token: "empresa-ficticia", companyName: "Empresa Ficticia 1", since: SINCE };

const job = (over: Record<string, unknown> = {}) => ({
  id: 1001,
  title: "Backend Engineer",
  absolute_url: "https://boards.example.test/empresa-ficticia/jobs/1001",
  location: { name: "Remote - LATAM" },
  first_published: "2026-10-10T12:00:00-03:00",
  updated_at: "2026-10-11T12:00:00-03:00",
  departments: [{ name: "Engineering" }, { name: "Platform" }],
  content:
    "&lt;p&gt;Construis APIs &amp;amp; servicios.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Node&lt;/li&gt;&lt;/ul&gt;",
  ...over,
});

const respond = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("fetchGreenhouseBoard", () => {
  it("mapea un aviso remoto completo", async () => {
    const fetchImpl = respond({ jobs: [job()] });
    const r = await fetchGreenhouseBoard({ ...board, fetchImpl, userAgent: "UA/1" });
    expect(r.status).toBe("ok");
    expect(r.jobs).toHaveLength(1);
    const j = r.jobs[0]!;
    expect(j.source).toMatchObject({
      kind: "greenhouse",
      name: "Greenhouse",
      externalId: "greenhouse:empresa-ficticia:1001",
      url: "https://boards.example.test/empresa-ficticia/jobs/1001",
    });
    expect(j.companyRaw).toBe("Empresa Ficticia 1");
    expect(j.title).toBe("Backend Engineer");
    expect(j.locationRaw).toBe("Remote - LATAM");
    expect(j.modality).toBe("remoto");
    expect(j.categories).toEqual(["Engineering", "Platform"]);
    expect(j.postedAt?.toISOString()).toBe("2026-10-10T15:00:00.000Z");
    expect(j.salaryMinUsd).toBeNull();
    expect(j.countriesAllowed).toBeNull();
    expect(j.jdText).toBe("Construis APIs & servicios.\n- Node");
    const call = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]!;
    expect(call[0]).toBe(
      "https://boards-api.greenhouse.io/v1/boards/empresa-ficticia/jobs?content=true",
    );
    expect(call[1].headers).toMatchObject({ "user-agent": "UA/1" });
  });

  it("descarta los no remotos y los cuenta", async () => {
    const r = await fetchGreenhouseBoard({
      ...board,
      fetchImpl: respond({
        jobs: [
          job({ id: 1, location: { name: "Buenos Aires, Argentina" } }),
          job({ id: 2, location: { name: "New York, NY" } }),
          job({ id: 3, location: { name: "Hybrid - Madrid" } }),
          job({ id: 4, location: { name: "" } }),
          job({ id: 5, location: { name: "Remote" } }),
        ],
      }),
    });
    expect(r.jobs.map((j) => j.source.externalId)).toEqual([
      "greenhouse:empresa-ficticia:1",
      "greenhouse:empresa-ficticia:4",
      "greenhouse:empresa-ficticia:5",
    ]);
    expect(r.filteredNonRemote).toBe(2);
  });

  it("descarta lo publicado antes de since; sin fecha se conserva", async () => {
    const r = await fetchGreenhouseBoard({
      ...board,
      fetchImpl: respond({
        jobs: [
          job({
            id: 1,
            first_published: "2026-09-01T00:00:00Z",
            updated_at: "2026-09-02T00:00:00Z",
          }),
          job({ id: 2, first_published: null, updated_at: "2026-10-05T00:00:00Z" }),
          job({ id: 3, first_published: null, updated_at: null }),
        ],
      }),
    });
    expect(r.jobs.map((j) => j.source.externalId?.split(":")[2])).toEqual(["2", "3"]);
  });

  it("estructura incompleta se saltea", async () => {
    const r = await fetchGreenhouseBoard({
      ...board,
      fetchImpl: respond({
        jobs: [
          job({ id: null }),
          job({ absolute_url: "javascript:alert(1)" }),
          job({ title: "" }),
          "x",
        ],
      }),
    });
    expect(r.jobs).toHaveLength(0);
    expect(r.skipped).toBe(4);
  });

  it("404 se informa como not_found, sin excepción", async () => {
    const r = await fetchGreenhouseBoard({ ...board, fetchImpl: respond({}, 404) });
    expect(r).toMatchObject({ status: "not_found", jobs: [] });
  });

  it("429 con reintento", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "1" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobs: [job()] })));
    const sleep = vi.fn(async () => {});
    const r = await fetchGreenhouseBoard({ ...board, fetchImpl, sleep });
    expect(r.jobs).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("token inválido se rechaza antes de hacer la request", async () => {
    const fetchImpl = vi.fn();
    const e = await fetchGreenhouseBoard({
      ...board,
      token: "../etc",
      fetchImpl: fetchImpl as never,
    }).catch((x: unknown) => x);
    expect(atsStatusOf(e)).toBe("invalid_token");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("respuesta sin `jobs` es un error de parseo", async () => {
    const e = await fetchGreenhouseBoard({ ...board, fetchImpl: respond({ otra: 1 }) }).catch(
      (x: unknown) => x,
    );
    expect(atsStatusOf(e)).toBe("parse");
  });
});
