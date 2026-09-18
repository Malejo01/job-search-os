import { describe, expect, it } from "vitest";
import page from "./__fixtures__/getonboard-search-page.json";
import {
  countryToIso,
  fetchGetOnBoardJobs,
  gobCategoryUrl,
  htmlToText,
  mapGobJob,
  type GobJobItem,
  type GobPage,
} from "./getonboard";

const fixture = page as unknown as GobPage;
const first = fixture.data[0]!;

describe("Get on Board: contrato con la respuesta real grabada (2026-09-10)", () => {
  it("mapea un item real a RawJob", () => {
    const raw = mapGobJob(first, "programming");
    expect(raw.source).toEqual({
      kind: "getonboard_api",
      name: "GoB programming",
      externalId: first.id,
      url: first.links?.public_url,
      rawRef: null,
      original: { contentType: "application/json", body: expect.any(String) },
    });
    expect(raw.title).toBe(first.attributes.title);
    expect(raw.companyRaw).toBe(first.attributes.company?.data?.attributes?.name);
    expect(raw.modality).toBe("remoto");
    expect(raw.countriesAllowed).toEqual(["*"]); // fully_remote
    expect(raw.locationRaw).toMatch(/^Remoto/);
    expect(raw.salaryMinUsd).toBe(first.attributes.min_salary);
    expect(raw.salaryMaxUsd).toBe(first.attributes.max_salary);
    expect(raw.salaryPeriod).toBe("mensual");
    expect(raw.candidatesCount).toBe(first.attributes.applications_count);
    expect(raw.postedAt).toEqual(new Date(first.attributes.published_at * 1000));
    expect(raw.seniority).toBe("Senior");
    expect(raw.contractType).toBe("Full time");
    expect(raw.tags.length).toBeGreaterThan(0);
    expect(raw.jdText).toContain(first.attributes.functions_headline ?? "");
    expect(raw.jdText).not.toMatch(/<[a-z]+>/i);
  });

  it("todos los items del fixture mapean sin tirar y con JD", () => {
    for (const item of fixture.data) {
      const raw = mapGobJob(item, "programming");
      expect(raw.jdText && raw.jdText.length).toBeGreaterThan(200);
      expect(raw.source.externalId).toBe(item.id);
    }
  });
});

describe("Get on Board: modalidades y países", () => {
  const base = (over: Partial<GobJobItem["attributes"]>): GobJobItem => ({
    ...first,
    id: "x",
    attributes: { ...first.attributes, ...over },
  });

  it("remote_local con location_tenants → países ISO del aviso (caso Empresa F)", () => {
    const raw = mapGobJob(
      base({
        remote_modality: "remote_local",
        countries: ["Remote"],
        location_tenants: {
          data: [
            { id: "peru", attributes: { name: "Peru" } },
            { id: "argentina", attributes: { name: "Argentina" } },
            { id: "chile", attributes: { name: "Chile" } },
            { id: "mexico", attributes: { name: "Mexico" } },
            { id: "colombia", attributes: { name: "Colombia" } },
          ],
        },
      }),
      "programming",
    );
    expect(raw.modality).toBe("remoto");
    expect(raw.countriesAllowed).toEqual(["PE", "AR", "CL", "MX", "CO"]);
    expect(raw.locationRaw).toBe("Remoto (Peru, Argentina, Chile, Mexico, Colombia)");
  });

  it("remote_local sin tenants → países desconocidos (riesgo para el prefiltro)", () => {
    const raw = mapGobJob(
      base({
        remote_modality: "remote_local",
        countries: ["Remote"],
        location_tenants: { data: [] },
      }),
      "programming",
    );
    expect(raw.countriesAllowed).toBeNull();
    expect(raw.locationRaw).toBe("Remoto (países no especificados)");
  });

  it("hybrid y no_remote → híbrido / presencial con el país", () => {
    const h = mapGobJob(
      base({ remote: false, remote_modality: "hybrid", countries: ["Chile"] }),
      "programming",
    );
    expect(h.modality).toBe("hibrido");
    expect(h.locationRaw).toBe("Híbrido (Chile)");
    expect(h.countriesAllowed).toEqual(["CL"]);
    const p = mapGobJob(
      base({ remote: false, remote_modality: "no_remote", countries: ["Argentina", "Chile"] }),
      "programming",
    );
    expect(p.modality).toBe("presencial");
    expect(p.countriesAllowed).toEqual(["AR", "CL"]);
  });

  it("sin salario → period null; sin company → 'desconocida'", () => {
    const raw = mapGobJob(
      base({ min_salary: null, max_salary: null, company: { data: null } }),
      "programming",
    );
    expect(raw.salaryPeriod).toBeNull();
    expect(raw.companyRaw).toBe("desconocida");
  });

  it("countryToIso: slugs, nombres con acento y desconocidos", () => {
    expect(countryToIso("peru")).toBe("PE");
    expect(countryToIso("Perú")).toBe("PE");
    expect(countryToIso("costa rica")).toBe("CR");
    expect(countryToIso("Atlantis")).toBe("ATLANTIS");
  });
});

describe("htmlToText", () => {
  it("viñetas, párrafos y entidades", () => {
    expect(
      htmlToText(
        "<ul><li><strong>+6 años</strong> de experiencia.</li><li>Inglés &amp; más&nbsp;</li></ul><p>Fin.</p>",
      ),
    ).toBe("- +6 años de experiencia.\n- Inglés & más\nFin.");
    expect(htmlToText(null)).toBe("");
  });
});

describe("fetchGetOnBoardJobs (fetch inyectado)", () => {
  const item = (id: string, publishedAt: number, remote = true): GobJobItem => ({
    ...first,
    id,
    attributes: { ...first.attributes, published_at: publishedAt, remote },
  });
  const now = 1_789_000_000; // epoch s
  const fakeFetch = (pages: Record<string, GobPage>): typeof fetch =>
    (async (url: string | URL | Request) => {
      const u = String(url);
      const category = /\/categories\/([a-z-]+)\/jobs/.exec(u)![1]!;
      const p = Number(/[?&]page=(\d+)/.exec(u)![1]);
      const body = pages[`${category}:${p}`] ?? {
        data: [],
        meta: { page: p, per_page: 100, total_pages: 0 },
      };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

  it("pagina, filtra por fecha y por remoto, y deduplica entre categorías", async () => {
    const pages: Record<string, GobPage> = {
      "programming:1": {
        data: [item("a", now - 100), item("h", now - 150, false), item("b", now - 200_000)],
        meta: { page: 1, per_page: 100, total_pages: 2 },
      },
      "programming:2": {
        data: [item("c", now - 300_000)],
        meta: { page: 2, per_page: 100, total_pages: 2 },
      },
      "machine-learning-ai:1": {
        data: [item("a", now - 100), item("d", now - 10)],
        meta: { page: 1, per_page: 100, total_pages: 1 },
      },
    };
    const r = await fetchGetOnBoardJobs({
      since: new Date((now - 86_400) * 1000),
      categories: ["programming", "machine-learning-ai"],
      fetchImpl: fakeFetch(pages),
    });
    // programming p1 tiene un item dentro de la ventana → sigue a p2; p2 es toda vieja → corta
    expect(r.pagesFetched).toBe(3);
    expect(r.seen).toBe(6);
    expect(r.jobs.map((j) => j.source.externalId)).toEqual(["a", "d"]);
    expect(r.jobs[0]!.source.name).toBe("GoB programming");
  });

  it("corta temprano cuando una página entera es más vieja que la ventana", async () => {
    const pages: Record<string, GobPage> = {
      "programming:1": {
        data: [item("old1", now - 500_000), item("old2", now - 600_000)],
        meta: { page: 1, per_page: 100, total_pages: 5 },
      },
      "programming:2": { data: [item("x", now)], meta: { page: 2, per_page: 100, total_pages: 5 } },
    };
    const r = await fetchGetOnBoardJobs({
      since: new Date((now - 86_400) * 1000),
      categories: ["programming"],
      fetchImpl: fakeFetch(pages),
    });
    expect(r.pagesFetched).toBe(1);
    expect(r.jobs).toEqual([]);
  });

  it("respeta maxPages y falla con HTTP != 200", async () => {
    const many: Record<string, GobPage> = {};
    for (let p = 1; p <= 5; p++)
      many[`programming:${p}`] = {
        data: [item(`p${p}`, now)],
        meta: { page: p, per_page: 1, total_pages: 5 },
      };
    const r = await fetchGetOnBoardJobs({
      since: new Date(0),
      categories: ["programming"],
      maxPages: 2,
      fetchImpl: fakeFetch(many),
    });
    expect(r.pagesFetched).toBe(2);
    const failing = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    await expect(
      fetchGetOnBoardJobs({ since: new Date(0), categories: ["programming"], fetchImpl: failing }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it("arma la URL de categoría con per_page, page y expand", () => {
    const u = gobCategoryUrl("https://x/api/v0", "programming", 2, 50);
    expect(u).toContain("/categories/programming/jobs?per_page=50&page=2&expand=");
    expect(decodeURIComponent(u)).toContain(
      '["company","tags","modality","seniority","location_tenants"]',
    );
  });
});

describe("Get on Board: crudo original (JS-024)", () => {
  it("conserva el item de la API tal cual llegó, antes de mapear y limpiar el HTML", () => {
    const raw = mapGobJob(first, "programming");
    expect(JSON.parse(raw.source.original!.body)).toEqual(first);
    // El JD mapeado es texto plano; el original conserva el HTML de la API
    expect(raw.source.original!.body).toContain(JSON.stringify(first.attributes.description));
  });
});
