import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { isPoolRemoteCandidate } from "@job-search-os/pipeline";
import { atsStatusOf, type AtsMapped } from "./ats-common";
import {
  fetchTeamtailorBoard,
  jsonFeedItems,
  MAX_ITEM_CHARS,
  mapTeamtailorJob,
  mapTeamtailorJsonItem,
  parseTeamtailorFeed,
} from "./teamtailor";

const xml = readFileSync(new URL("./__fixtures__/teamtailor-sample.xml", import.meta.url), "utf8");
const jsonFeed = readFileSync(
  new URL("./__fixtures__/teamtailor-jobs.json", import.meta.url),
  "utf8",
);
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

  it("un <item> sin cierre corta la lectura y uno más largo que el tope se saltea (seguridad)", () => {
    const ok = "<item><guid>g-1</guid><title>Uno</title></item>";
    expect(parseTeamtailorFeed(`<rss>${ok}<item><title>sin cierre`).map((i) => i.guid)).toEqual([
      "g-1",
    ]);
    const huge = `<item><guid>g-2</guid><description>${"x".repeat(MAX_ITEM_CHARS)}</description></item>`;
    expect(parseTeamtailorFeed(`<rss>${huge}${ok}</rss>`).map((i) => i.guid)).toEqual(["g-1"]);
    // `<items>` u otra etiqueta que empieza igual no se toma como item
    expect(parseTeamtailorFeed("<rss><items>x</items></rss>")).toEqual([]);
  });

  it("muchas aperturas sin cierre no cuelgan el parseo (lineal)", () => {
    const hostile = `<rss>${"<item><title>".repeat(50_000)}</rss>`;
    const t0 = Date.now();
    expect(parseTeamtailorFeed(hostile)).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it("un cuerpo sin items da una lista vacía", () => {
    expect(parseTeamtailorFeed("<rss><channel></channel></rss>")).toEqual([]);
    expect(parseTeamtailorFeed("<html>no es un feed</html>")).toEqual([]);
  });
});

describe("mapTeamtailorJob", () => {
  const minimal = (over: Record<string, unknown>) =>
    mapTeamtailorJob(
      {
        guid: "g-1",
        title: "Puesto Ficticio",
        link: "https://empresa-ficticia.teamtailor.com/jobs/1-puesto",
        locations: [],
        ...over,
      },
      board,
    );

  it("el link tiene que quedar en teamtailor.com: otro host se saltea (seguridad)", () => {
    expect(minimal({})).not.toBe("skip");
    expect(minimal({ link: "https://teamtailor.com.x.example/jobs/1-puesto" })).toBe("skip");
    expect(minimal({ link: "https://x.example/jobs/1-puesto" })).toBe("skip");
    expect(minimal({ link: "javascript:alert(1)" })).toBe("skip");
  });

  it("un guid de más de 200 caracteres se saltea (seguridad)", () => {
    expect(minimal({ guid: "g".repeat(200) })).not.toBe("skip");
    expect(minimal({ guid: "g".repeat(201) })).toBe("skip");
  });

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

/** Responde distinto según el feed pedido: `jobs.json` o `jobs.rss`. */
const routed = (json: () => Response, rss: () => Response) =>
  vi.fn(async (url: string) => (url.endsWith("/jobs.json") ? json() : rss()));
const ok = (body: string) => () => new Response(body, { status: 200 });
const status = (code: number) => () => new Response("", { status: code });

const rssFullyAndOnsite =
  "<rss><channel>" +
  "<item><guid>rss-1</guid><title>Puesto Remoto Ficticio</title><link>https://empresa-ficticia.teamtailor.com/jobs/11-remoto</link><remoteStatus>fully</remoteStatus></item>" +
  "<item><guid>rss-2</guid><title>Puesto Presencial Ficticio</title><link>https://empresa-ficticia.teamtailor.com/jobs/12-presencial</link><remoteStatus>onsite</remoteStatus></item>" +
  "</channel></rss>";

describe("fetchTeamtailorBoard · JSON Feed primero, avisos del RSS (R16-3)", () => {
  it("JSON Feed válido + RSS con un aviso fully y uno onsite: solo sale el fully, de dos pedidos", async () => {
    const fetchImpl = routed(ok(jsonFeed), ok(rssFullyAndOnsite));
    const r = await fetchTeamtailorBoard({ ...board, fetchImpl: fetchImpl as never });
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([
      "https://empresa-ficticia.teamtailor.com/jobs.json",
      "https://empresa-ficticia.teamtailor.com/jobs.rss",
    ]);
    expect(r.jobs.map((j) => j.source.externalId)).toEqual(["teamtailor:empresa-ficticia:rss-1"]);
    expect(r.filteredNonRemote).toBe(1);
    // Ningún aviso del JSON Feed llega al pool
    expect(r.jobs.some((j) => j.source.externalId?.includes("jf-"))).toBe(false);
  });

  it("JSON Feed válido sin RSS disponible: cero avisos, ninguno presencial", async () => {
    const fetchImpl = routed(ok(jsonFeed), status(404));
    const r = await fetchTeamtailorBoard({ ...board, fetchImpl: fetchImpl as never });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(r.jobs).toEqual([]);
  });

  it("el filtro de remotos descarta todos los ítems del JSON Feed (fallo cerrado)", async () => {
    const { fetchAtsBoard } = await import("./ats-common");
    const r = await fetchAtsBoard(
      "teamtailor",
      { ...board, fetchImpl: routed(ok(jsonFeed), status(404)) as never },
      {
        url: "https://empresa-ficticia.teamtailor.com/jobs.json",
        items: jsonFeedItems,
        map: (item) => mapTeamtailorJsonItem(item, board),
      },
    );
    expect(r.seen).toBe(8);
    expect(r.skipped).toBe(4);
    // los 4 ítems válidos quedan afuera por no tener modalidad verificada
    expect(r.filteredNonRemote).toBe(4);
    expect(r.jobs).toEqual([]);
  });

  it("región na: pide jobs.json en el host .na.teamtailor.com", async () => {
    const fetchImpl = routed(ok(jsonFeed), status(404));
    await fetchTeamtailorBoard({ ...board, region: "na", fetchImpl: fetchImpl as never });
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      "https://empresa-ficticia.na.teamtailor.com/jobs.json",
    );
  });

  it("JSON Feed con 404 → cae al RSS: dos GET, jobs.json y después jobs.rss", async () => {
    const fetchImpl = routed(status(404), ok(xml));
    const r = await fetchTeamtailorBoard({ ...board, fetchImpl: fetchImpl as never });
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([
      "https://empresa-ficticia.teamtailor.com/jobs.json",
      "https://empresa-ficticia.teamtailor.com/jobs.rss",
    ]);
    expect(r.status).toBe("ok");
    expect(r.seen).toBe(7);
    expect(r.jobs).toHaveLength(4);
  });

  it("JSON Feed con forma inesperada → cae al RSS, sin usar nada a medias", async () => {
    const shapes = [
      "{}",
      '{"jobs":[]}',
      "[]",
      "null",
      '{"version":"https://jsonfeed.org/version/1.1"}',
      '{"version":"https://jsonfeed.org/version/1.1","items":"no es una lista"}',
      '{"version":"https://otro.example/v1","items":[]}',
      '{"version":2,"items":[]}',
    ];
    for (const shape of shapes) {
      const fetchImpl = routed(ok(shape), ok(xml));
      const r = await fetchTeamtailorBoard({ ...board, fetchImpl: fetchImpl as never });
      expect(fetchImpl, shape).toHaveBeenCalledTimes(2);
      expect(r.seen, shape).toBe(7);
    }
  });

  it("JSON Feed que no es JSON, o con otro 4xx → cae al RSS", async () => {
    for (const json of [ok("<html>página de error</html>"), ok("{ roto"), status(403)]) {
      const fetchImpl = routed(json, ok(xml));
      const r = await fetchTeamtailorBoard({ ...board, fetchImpl: fetchImpl as never });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(r.jobs).toHaveLength(4);
    }
  });

  it("un JSON Feed válido sin ítems también sigue al RSS (solo se usa si trajo avisos)", async () => {
    const empty = '{"version":"https://jsonfeed.org/version/1.1","items":[]}';
    const fetchImpl = routed(ok(empty), ok(xml));
    const r = await fetchTeamtailorBoard({ ...board, fetchImpl: fetchImpl as never });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(r.seen).toBe(7);
    expect(r.jobs).toHaveLength(4);
  });

  it("fallan los dos por 404 → not_found, sin excepción", async () => {
    const fetchImpl = routed(status(404), status(404));
    const r = await fetchTeamtailorBoard({ ...board, fetchImpl: fetchImpl as never });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(r.status).toBe("not_found");
    expect(r.jobs).toEqual([]);
  });

  it("fallan los dos porque no son un feed → parse (código cerrado)", async () => {
    const fetchImpl = routed(ok("{}"), ok("<html>no es un feed</html>"));
    const e = await fetchTeamtailorBoard({ ...board, fetchImpl: fetchImpl as never }).catch(
      (x: unknown) => x,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(atsStatusOf(e)).toBe("parse");
  });

  it("JSON Feed válido y RSS con error de servidor: el board falla con su código, sin avisos del JSON", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = routed(ok(jsonFeed), status(500));
    const e = await fetchTeamtailorBoard({ ...board, fetchImpl: fetchImpl as never, sleep }).catch(
      (x: unknown) => x,
    );
    expect(atsStatusOf(e)).toBe("http_5xx");
  });

  it("fallos transitorios del JSON Feed (5xx, 429) no se reintentan por el RSS", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = routed(status(503), ok(xml));
    const e = await fetchTeamtailorBoard({
      ...board,
      fetchImpl: fetchImpl as never,
      sleep,
    }).catch((x: unknown) => x);
    expect(atsStatusOf(e)).toBe("http_5xx");
    // un reintento del propio GET (503), pero ningún pedido al RSS
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([
      "https://empresa-ficticia.teamtailor.com/jobs.json",
      "https://empresa-ficticia.teamtailor.com/jobs.json",
    ]);
  });

  it("429 con Retry-After en el JSON Feed: espera y reintenta una vez", async () => {
    const sleep = vi.fn(async () => {});
    let calls = 0;
    const fetchImpl = routed(
      () =>
        ++calls === 1
          ? new Response("", { status: 429, headers: { "retry-after": "2" } })
          : new Response(jsonFeed),
      ok(xml),
    );
    const r = await fetchTeamtailorBoard({ ...board, fetchImpl: fetchImpl as never, sleep });
    expect(sleep).toHaveBeenCalledWith(2000);
    // jobs.json (429), jobs.json de nuevo (ok, sin avisos remotos) y jobs.rss
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(r.jobs).toHaveLength(4);
  });

  it("token inválido: se rechaza antes de pedir cualquiera de los dos feeds", async () => {
    const fetchImpl = vi.fn();
    const e = await fetchTeamtailorBoard({
      companyName: "Empresa Ficticia 1",
      token: "a.b",
      fetchImpl: fetchImpl as never,
    }).catch((x: unknown) => x);
    expect(atsStatusOf(e)).toBe("invalid_token");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("jsonFeedItems", () => {
  it("acepta JSON Feed 1.0 y 1.1 con items como lista", () => {
    expect(jsonFeedItems({ version: "https://jsonfeed.org/version/1.1", items: [{}] })).toEqual([
      {},
    ]);
    expect(jsonFeedItems({ version: "https://jsonfeed.org/version/1", items: [] })).toEqual([]);
  });

  it("todo lo demás se descarta entero (null)", () => {
    for (const body of [
      null,
      undefined,
      "texto",
      42,
      [],
      {},
      { items: [] },
      { version: "https://jsonfeed.org/version/2", items: [] },
      { version: "https://jsonfeed.org/version/1.1" },
      { version: "https://jsonfeed.org/version/1.1", items: {} },
    ]) {
      expect(jsonFeedItems(body), JSON.stringify(body)).toBeNull();
    }
  });
});

describe("mapTeamtailorJsonItem", () => {
  const feed = JSON.parse(jsonFeed) as { items: Record<string, unknown>[] };
  const map = (item: Record<string, unknown>) => mapTeamtailorJsonItem(item, board);
  const mappedJson = (index: number): Exclude<AtsMapped, "skip" | "unlisted"> => {
    const m = map(feed.items[index]!);
    if (m === "skip" || m === "unlisted") throw new Error(`item ${index}: ${m}`);
    return m;
  };

  it("mapea los campos estándar: id, url, título, fecha, descripción y tags", () => {
    const { raw } = mappedJson(0);
    expect(raw.source).toMatchObject({
      name: "Teamtailor",
      externalId: "teamtailor:empresa-ficticia:jf-0001",
      url: "https://empresa-ficticia.teamtailor.com/jobs/2001-analista-administrativo-ficticio",
    });
    expect(raw.title).toBe("Analista Administrativo/a Ficticio");
    expect(raw.companyRaw).toBe("Empresa Ficticia 1");
    expect(raw.postedAt?.toISOString()).toBe("2026-10-20T09:30:00.000Z");
    expect(raw.categories).toEqual(["Administración", "Finanzas"]);
  });

  it("content_html pasa por el mismo limpiador que el RSS; sin HTML usa content_text", () => {
    const html = mappedJson(0).raw.jdText!;
    expect(html).toContain("Buscamos a alguien para el equipo & la gestión.");
    expect(html).toContain("- Excel");
    expect(html).toContain("- Facturación");
    expect(html).not.toMatch(/<|&amp;|&lt;/);
    expect(mappedJson(1).raw.jdText).toBe("Puesto de prueba solo con texto plano.");
    expect(mappedJson(1).raw.postedAt?.toISOString()).toBe("2026-10-21T10:00:00.000Z");
  });

  it("lo que el feed no dice queda null: ubicación, países, salario; modalidad desconocida", () => {
    const m = mappedJson(0);
    expect(m.raw.locationRaw).toBeNull();
    expect(m.raw.countriesAllowed).toBeNull();
    expect(m.raw.modality).toBe("desconocida");
    // Falla cerrado: sin modalidad verificada, no cuenta como remoto (ver el test del filtro más abajo)
    expect(m.remote).toEqual({ locationText: null, workplaceType: null, isRemote: false });
    expect(isPoolRemoteCandidate(m.remote)).toBe(false);
    expect(m.raw).toMatchObject({
      salaryMinUsd: null,
      salaryMaxUsd: null,
      salaryPeriod: null,
      salaryNote: null,
      contractType: null,
    });
    expect(mappedJson(2).raw.jdText).toBe("El id sale del path del link.");
    expect(mappedJson(2).raw.postedAt).toBeNull();
  });

  it("sin id, el id sale del número inicial del path /jobs/<id>-<slug>", () => {
    expect(mappedJson(2).raw.source.externalId).toBe("teamtailor:empresa-ficticia:3003");
  });

  it("ítem sin id (y sin número en el link) → skip", () => {
    expect(map(feed.items[3]!)).toBe("skip");
  });

  it("ítem con link de otro host → skip (seguridad)", () => {
    expect(map(feed.items[4]!)).toBe("skip");
    for (const url of [
      "https://teamtailor.com.x.example/jobs/1-a",
      "https://x.example/jobs/1-a",
      "ftp://empresa-ficticia.teamtailor.com/jobs/1-a",
      "javascript:alert(1)",
    ]) {
      expect(map({ ...feed.items[0]!, url }), url).toBe("skip");
    }
    // external_url (otro sitio) no reemplaza a url
    expect(
      map({
        id: "x",
        title: "T",
        external_url: "https://empresa-ficticia.teamtailor.com/jobs/1-a",
      }),
    ).toBe("skip");
  });

  it("sin título, link no http(s) o id de más de 200 caracteres → skip", () => {
    expect(map(feed.items[5]!)).toBe("skip");
    expect(map(feed.items[6]!)).toBe("skip");
    expect(map({ ...feed.items[0]!, title: null })).toBe("skip");
    expect(map({ ...feed.items[0]!, id: "g".repeat(200) })).not.toBe("skip");
    expect(map({ ...feed.items[0]!, id: "g".repeat(201) })).toBe("skip");
  });

  it("tags que no son texto o están vacíos se ignoran", () => {
    expect(mappedJson(7).raw.categories).toEqual(["Ventas"]);
    expect(mappedJson(1).raw.categories).toEqual([]);
    expect(map({ ...feed.items[0]!, tags: "no es una lista" })).not.toBe("skip");
  });
});

describe("fetchTeamtailorBoard (RSS, como antes)", () => {
  it("200 por RSS: mapea y cuenta lo saltado y lo filtrado (el JSON da 404)", async () => {
    const fetchImpl = routed(status(404), ok(xml));
    const r = await fetchTeamtailorBoard({ ...board, fetchImpl: fetchImpl as never });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]![0]).toBe("https://empresa-ficticia.teamtailor.com/jobs.rss");
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

  it("región na: el RSS también va al host .na.teamtailor.com", async () => {
    const fetchImpl = routed(status(404), ok("<rss><channel></channel></rss>"));
    await fetchTeamtailorBoard({ ...board, region: "na", fetchImpl: fetchImpl as never });
    expect(fetchImpl.mock.calls[1]![0]).toBe("https://empresa-ficticia.na.teamtailor.com/jobs.rss");
  });

  it("manda el User-Agent identificable en los dos pedidos", async () => {
    const fetchImpl = routed(status(404), ok("<rss></rss>"));
    await fetchTeamtailorBoard({ ...board, userAgent: "UA/1", fetchImpl: fetchImpl as never });
    for (const call of fetchImpl.mock.calls) {
      const init = (call as unknown as [string, RequestInit])[1];
      expect(init.headers).toMatchObject({ "user-agent": "UA/1" });
    }
  });

  it("404 en los dos → not_found, sin excepción", async () => {
    const r = await fetchTeamtailorBoard({
      ...board,
      fetchImpl: respond("", { status: 404 }) as never,
    });
    expect(r.status).toBe("not_found");
    expect(r.jobs).toEqual([]);
  });

  it("429 con Retry-After en el RSS: espera y reintenta una vez", async () => {
    const sleep = vi.fn(async () => {});
    let calls = 0;
    const fetchImpl = routed(status(404), () =>
      ++calls === 1
        ? new Response("", { status: 429, headers: { "retry-after": "2" } })
        : new Response(xml),
    );
    const r = await fetchTeamtailorBoard({ ...board, fetchImpl: fetchImpl as never, sleep });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
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

  it("exactamente 100 items en el RSS: avisa que el feed puede estar cortado y no pide más", async () => {
    const items = Array.from(
      { length: 100 },
      (_, i) =>
        `<item><guid>g${i}</guid><title>Puesto ${i}</title><link>https://empresa-ficticia.teamtailor.com/jobs/${i + 1}-p</link><remoteStatus>fully</remoteStatus></item>`,
    ).join("");
    const fetchImpl = routed(status(404), ok(`<rss><channel>${items}</channel></rss>`));
    const r = await fetchTeamtailorBoard({ ...board, fetchImpl: fetchImpl as never });
    expect(r.seen).toBe(100);
    expect(r.feedMaybeTruncated).toBe(true);
    // jobs.json (404) y jobs.rss: nunca una segunda página
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
