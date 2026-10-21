import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { atsStatusOf, type AtsMapped } from "./ats-common";
import { fetchTeamtailorBoard, mapTeamtailorJob, parseTeamtailorFeed } from "./teamtailor";

const xml = readFileSync(new URL("./__fixtures__/teamtailor-sample.xml", import.meta.url), "utf8");
const board = { token: "empresa-ficticia", companyName: "Empresa Ficticia 1" };

const respond = (body: string, init: ResponseInit = {}) =>
  vi.fn(async (_url: string) => new Response(body, { status: 200, ...init }));

function mapped(index: number): Exclude<AtsMapped, "skip" | "unlisted"> {
  const item = parseTeamtailorFeed(xml)[index]! as unknown as Record<string, unknown>;
  const m = mapTeamtailorJob(item, board);
  if (m === "skip" || m === "unlisted") throw new Error(`item ${index}: ${m}`);
  return m;
}

describe("parseTeamtailorFeed", () => {
  const items = parseTeamtailorFeed(xml);

  it("lee todos los items del feed, sin validarlos", () => {
    expect(items).toHaveLength(7);
    expect(items.map((i) => i.guid)).toEqual([
      "tt-guid-0001",
      "tt-guid-0002",
      "tt-guid-0003",
      "tt-guid-0004",
      "tt-guid-0005",
      "tt-guid-0006",
      null,
    ]);
  });

  it("item con tres ubicaciones: name, city y country de cada una", () => {
    expect(items[0]!.locations).toEqual([
      { name: "Oficina Uno", city: "Ciudad Uno", country: "Spain" },
      { name: "Oficina Dos", city: "Ciudad Dos", country: "Spain" },
      { name: "Sede Remota Tres", city: null, country: null },
    ]);
    expect(items[0]).toMatchObject({
      department: "Ingeniería",
      role: "Backend",
      division: "División Uno",
      remoteStatus: "fully",
    });
  });

  it("sin tt:locations, o vacío, no hay ubicaciones; department y role vacíos o autocerrados son null", () => {
    expect(items[1]!.locations).toEqual([]);
    expect(items[4]!.locations).toEqual([]);
    expect(items[1]).toMatchObject({ department: null, role: null, division: null });
    expect(items[2]!.role).toBeNull();
  });

  it("los datos de una ubicación no se confunden con los del item", () => {
    expect(items[3]!.locations).toEqual([{ name: "Región", city: null, country: "LATAM" }]);
    expect(items[3]!.title).toBe("Soporte Regional Ficticio");
  });

  it("un cuerpo sin items da una lista vacía", () => {
    expect(parseTeamtailorFeed("<rss><channel></channel></rss>")).toEqual([]);
    expect(parseTeamtailorFeed("<html>no es un feed</html>")).toEqual([]);
  });
});

describe("mapTeamtailorJob", () => {
  it("mapea un aviso completo: id del guid, fuente, empresa, fecha y categorías", () => {
    const { raw } = mapped(0);
    expect(raw.source).toMatchObject({
      kind: expect.any(String),
      name: "Teamtailor",
      externalId: "teamtailor:empresa-ficticia:tt-guid-0001",
      url: "https://empresa-ficticia.teamtailor.com/jobs/1001-ingeniero-backend-ficticio",
    });
    expect(raw.title).toBe("Ingeniero/a Backend Ficticio");
    expect(raw.companyRaw).toBe("Empresa Ficticia 1");
    expect(raw.postedAt?.toISOString()).toBe("2026-10-12T09:30:00.000Z");
    expect(raw.categories).toEqual(["Ingeniería", "Backend"]);
    expect(raw.modality).toBe("remoto");
  });

  it("descripción: entidades escapadas decodificadas y pasadas a texto", () => {
    const { raw } = mapped(0);
    expect(raw.jdText).toContain("Buscamos a alguien para el equipo & la plataforma.");
    expect(raw.jdText).toContain("- SQL");
    expect(raw.jdText).toContain("- Python");
    expect(raw.jdText).not.toMatch(/<|&lt;|&amp;/);
  });

  it("tres ubicaciones: se unen con joinAtsLocations, sin inventar países", () => {
    const { raw, remote } = mapped(0);
    expect(raw.locationRaw).toBe("Ciudad Uno, Spain; Ciudad Dos, Spain; Sede Remota Tres");
    expect(remote.locationText).toBe(raw.locationRaw);
    expect(raw.countriesAllowed).toBeNull();
  });

  it("sin ubicaciones: locationRaw y countriesAllowed quedan null", () => {
    const { raw } = mapped(1);
    expect(raw.locationRaw).toBeNull();
    expect(raw.countriesAllowed).toBeNull();
  });

  it("country = LATAM (no ISO) se guarda como texto", () => {
    const { raw } = mapped(3);
    expect(raw.locationRaw).toBe("LATAM");
    expect(raw.countriesAllowed).toBeNull();
  });

  it("remoteStatus: fully → remoto, hybrid → híbrido, onsite → presencial", () => {
    expect(mapped(0)).toMatchObject({
      raw: { modality: "remoto" },
      remote: { workplaceType: "remote" },
    });
    expect(mapped(1)).toMatchObject({
      raw: { modality: "hibrido" },
      remote: { workplaceType: "hybrid" },
    });
    expect(mapped(2)).toMatchObject({
      raw: { modality: "presencial" },
      remote: { workplaceType: "onsite" },
    });
  });

  it("remoteStatus none o ausente → desconocida, NUNCA remoto", () => {
    for (const i of [3, 4]) {
      const m = mapped(i);
      expect(m.raw.modality).toBe("desconocida");
      expect(m.remote.workplaceType).toBeNull();
    }
  });

  it("department y role vacíos no suman categorías", () => {
    expect(mapped(1).raw.categories).toEqual([]);
    expect(mapped(2).raw.categories).toEqual(["Operaciones"]);
  });

  it("el feed no trae salario: todo null", () => {
    expect(mapped(0).raw).toMatchObject({
      salaryMinUsd: null,
      salaryMaxUsd: null,
      salaryPeriod: null,
      salaryNote: null,
    });
  });

  it("sin guid, el id sale del número inicial del path /jobs/<id>-<slug>", () => {
    expect(mapped(6).raw.source.externalId).toBe("teamtailor:empresa-ficticia:7777");
  });

  it("falla cerrado por item: sin link, sin título, link no http(s) o sin id → skip", () => {
    const items = parseTeamtailorFeed(xml) as unknown as Record<string, unknown>[];
    expect(mapTeamtailorJob(items[5]!, board)).toBe("skip");
    expect(mapTeamtailorJob({ ...items[0]!, title: null }, board)).toBe("skip");
    expect(mapTeamtailorJob({ ...items[0]!, link: "javascript:alert(1)" }, board)).toBe("skip");
    expect(mapTeamtailorJob({ ...items[0]!, link: "ftp://x.example/jobs/1-a" }, board)).toBe(
      "skip",
    );
    // Sin guid y con un link cuyo path no empieza con /jobs/<número>
    expect(
      mapTeamtailorJob(
        { ...items[0]!, guid: null, link: "https://x.example/otra-cosa/abc" },
        board,
      ),
    ).toBe("skip");
  });
});

describe("fetchTeamtailorBoard", () => {
  it("200: un solo GET al feed, mapea y cuenta lo saltado y lo filtrado", async () => {
    const fetchImpl = respond(xml);
    const r = await fetchTeamtailorBoard({ ...board, fetchImpl: fetchImpl as never });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://empresa-ficticia.teamtailor.com/jobs.rss");
    expect(r.status).toBe("ok");
    expect(r.seen).toBe(7);
    expect(r.skipped).toBe(1);
    // hybrid y onsite no son remotos
    expect(r.filteredNonRemote).toBe(2);
    expect(r.jobs.map((j) => j.source.externalId)).toEqual([
      "teamtailor:empresa-ficticia:tt-guid-0001",
      "teamtailor:empresa-ficticia:tt-guid-0004",
      "teamtailor:empresa-ficticia:tt-guid-0005",
      "teamtailor:empresa-ficticia:7777",
    ]);
    expect(r.feedMaybeTruncated).toBeUndefined();
  });

  it("región na: host .na.teamtailor.com", async () => {
    const fetchImpl = respond("<rss><channel></channel></rss>");
    await fetchTeamtailorBoard({ ...board, region: "na", fetchImpl: fetchImpl as never });
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://empresa-ficticia.na.teamtailor.com/jobs.rss");
  });

  it("manda el User-Agent identificable", async () => {
    const fetchImpl = respond("<rss></rss>");
    await fetchTeamtailorBoard({ ...board, userAgent: "UA/1", fetchImpl: fetchImpl as never });
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toMatchObject({ "user-agent": "UA/1" });
  });

  it("404 → not_found, sin excepción", async () => {
    const r = await fetchTeamtailorBoard({
      ...board,
      fetchImpl: respond("", { status: 404 }) as never,
    });
    expect(r.status).toBe("not_found");
    expect(r.jobs).toEqual([]);
  });

  it("429 con Retry-After: espera y reintenta una vez", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(new Response(xml));
    const r = await fetchTeamtailorBoard({ ...board, fetchImpl, sleep });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(r.jobs.length).toBeGreaterThan(0);
  });

  it("cuerpo por encima del tope → too_large", async () => {
    const big = respond("a".repeat(15 * 1024 * 1024 + 1));
    const e = await fetchTeamtailorBoard({ ...board, fetchImpl: big as never }).catch(
      (x: unknown) => x,
    );
    expect(atsStatusOf(e)).toBe("too_large");
  });

  it("una respuesta que no es un feed RSS → parse", async () => {
    const e = await fetchTeamtailorBoard({
      ...board,
      fetchImpl: respond("<html>página de error</html>") as never,
    }).catch((x: unknown) => x);
    expect(atsStatusOf(e)).toBe("parse");
  });

  it("token o región inválidos se rechazan antes de la request", async () => {
    const fetchImpl = vi.fn();
    for (const o of [
      { token: "a.b" },
      { token: "a_b" },
      { token: "Empresa" },
      { token: "a".repeat(64) },
      { token: "a@b" },
      { token: "a/b" },
      { token: "x", region: "eu" },
    ]) {
      const e = await fetchTeamtailorBoard({
        companyName: "Empresa Ficticia 1",
        ...o,
        fetchImpl: fetchImpl as never,
      }).catch((x: unknown) => x);
      expect(atsStatusOf(e), JSON.stringify(o)).toBe("invalid_token");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("exactamente 100 items: avisa que el feed puede estar cortado y no pide más", async () => {
    const items = Array.from(
      { length: 100 },
      (_, i) =>
        `<item><guid>g${i}</guid><title>Puesto ${i}</title><link>https://empresa-ficticia.teamtailor.com/jobs/${i + 1}-p</link><remoteStatus>fully</remoteStatus></item>`,
    ).join("");
    const fetchImpl = respond(`<rss><channel>${items}</channel></rss>`);
    const r = await fetchTeamtailorBoard({ ...board, fetchImpl: fetchImpl as never });
    expect(r.seen).toBe(100);
    expect(r.feedMaybeTruncated).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
