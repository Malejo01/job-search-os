import { readFileSync } from "node:fs";
import { inferRoleHints } from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import { fetchWwrJobs, mapWwrJob, parseWwrFeed, WWR_POOL_CATEGORIES, wwrCategoryUrl } from "./wwr";

const xml = readFileSync(new URL("./__fixtures__/wwr-sample.xml", import.meta.url), "utf8");

const xmlFetch = (feeds: Record<string, string>, status = 200): typeof fetch =>
  (async (url: string | URL | Request) => {
    const category = /\/([a-z-]+)\.rss$/.exec(String(url))![1]!;
    return new Response(feeds[category] ?? "<rss></rss>", { status });
  }) as unknown as typeof fetch;

describe("WWR: parseo del feed de ejemplo (formato a verificar)", () => {
  const { items, skipped } = parseWwrFeed(xml);

  it("saltea el item roto y cuenta el salteo", () => {
    expect(skipped).toBe(1);
    expect(items.map((i) => i.guid)).toEqual([
      "https://example.com/wwr/empresa-e-senior-platform-engineer",
      "https://example.com/wwr/empresa-f-backend-developer",
      null,
      "https://example.com/wwr/empresa-h-viejo",
    ]);
  });

  it("mapea un item con CDATA, región worldwide y tipo", () => {
    const raw = mapWwrJob(items[0]!, "remote-programming-jobs");
    expect(raw.source.kind).toBe("wwr");
    expect(raw.categories).toEqual(["remote-programming-jobs"]);
    expect(raw.source.name).toBe("WWR remote-programming-jobs");
    expect(raw.source.externalId).toBe(
      "wwr:https://example.com/wwr/empresa-e-senior-platform-engineer",
    );
    expect(raw.source.original).toEqual({
      contentType: "application/rss+xml",
      body: expect.stringContaining("<title>Empresa E: Senior Platform Engineer</title>"),
    });
    expect(raw.companyRaw).toBe("Empresa E");
    expect(raw.title).toBe("Senior Platform Engineer");
    expect(raw.modality).toBe("remoto");
    expect(raw.countriesAllowed).toEqual(["*"]);
    expect(raw.locationRaw).toBe("Remoto (Anywhere in the World)");
    expect(raw.contractType).toBe("Full-Time");
    expect(raw.postedAt).toEqual(new Date("2026-09-10T01:46:40Z"));
    expect(raw.salaryPeriod).toBeNull();
    expect(raw.jdText).toBe("Plataforma ficticia.\n- Kubernetes\n- Terraform & CI");
  });

  it("descripción con entidades (sin CDATA) → texto plano; región restringida → null", () => {
    const raw = mapWwrJob(items[1]!, "remote-back-end-programming-jobs");
    expect(raw.jdText).toBe("Equipo ficticio & remoto.\nPago en dólares.");
    expect(raw.locationRaw).toBe("Remoto (USA Only)");
    expect(raw.countriesAllowed).toBeNull();
  });

  it("título sin ':' → empresa desconocida; sin región → países no especificados; guid ausente → link", () => {
    const raw = mapWwrJob(items[2]!, "remote-programming-jobs");
    expect(raw.companyRaw).toBe("desconocida");
    expect(raw.title).toBe("Desarrollador sin empresa en el titulo");
    expect(raw.locationRaw).toBe("Remoto (países no especificados)");
    expect(raw.countriesAllowed).toBeNull();
    expect(raw.source.externalId).toBe("wwr:https://example.com/wwr/sin-empresa");
  });
});

describe("WWR: link al sitio de empleos de la empresa", () => {
  const item = (description: string) => ({
    title: "Empresa Z: Puesto Z",
    link: "https://example.com/wwr/z",
    guid: null,
    pubDate: "Wed, 10 Sep 2026 01:46:40 +0000",
    region: null,
    category: null,
    type: null,
    description,
    xml: "<item></item>",
  });

  it("rescata el href de un ATS y lo agrega al final de la JD", () => {
    const raw = mapWwrJob(
      item(
        '<p>Texto ficticio.</p><p><a href="https://jobs.lever.co/empresa-z/123?x=1&amp;y=2">Apply</a></p>',
      ),
      "remote-programming-jobs",
    );
    expect(raw.jdText).toBe(
      "Texto ficticio.\nApply\n\nSitio de empleos de la empresa: https://jobs.lever.co/empresa-z/123",
    );
  });

  it("ignora hrefs que no son de un ATS reconocido o no son https", () => {
    const raw = mapWwrJob(
      item(
        '<p><a href="https://example.com/jobs/1">a</a> <a href="http://jobs.lever.co/x/1">b</a></p>',
      ),
      "remote-programming-jobs",
    );
    expect(raw.jdText).toBe("a b");
  });

  it("no repite el link si la JD ya lo trae como texto", () => {
    const raw = mapWwrJob(
      item(
        '<p>https://jobs.lever.co/empresa-z/123</p><a href="https://jobs.lever.co/empresa-z/123">x</a>',
      ),
      "remote-programming-jobs",
    );
    expect(raw.jdText).toBe("https://jobs.lever.co/empresa-z/123\nx");
  });
});

describe("fetchWwrJobs (fetch inyectado)", () => {
  const since = new Date("2026-09-01T00:00:00Z");

  it("una llamada por categoría, filtra por fecha y deduplica por guid", async () => {
    const r = await fetchWwrJobs({
      since,
      categories: ["remote-programming-jobs", "remote-back-end-programming-jobs"],
      fetchImpl: xmlFetch({
        "remote-programming-jobs": xml,
        "remote-back-end-programming-jobs": xml,
      }),
    });
    expect(r.skipped).toBe(2);
    expect(r.seen).toBe(8);
    expect(r.jobs.map((j) => j.source.externalId)).toEqual([
      "wwr:https://example.com/wwr/empresa-e-senior-platform-engineer",
      "wwr:https://example.com/wwr/empresa-f-backend-developer",
      "wwr:https://example.com/wwr/sin-empresa",
    ]);
    expect(r.jobs[0]!.source.name).toBe("WWR remote-programming-jobs");
  });

  it("un aviso en varias categorías las une y el role_hints incluye backend", async () => {
    const r = await fetchWwrJobs({
      since,
      categories: ["remote-programming-jobs", "remote-back-end-programming-jobs"],
      fetchImpl: xmlFetch({
        "remote-programming-jobs": xml,
        "remote-back-end-programming-jobs": xml,
      }),
    });
    const job = r.jobs[0]!;
    expect(job.categories).toEqual(["remote-programming-jobs", "remote-back-end-programming-jobs"]);
    expect(
      inferRoleHints({ sourceKind: "wwr", title: "Cargo sin pistas", categories: job.categories }),
    ).toContain("backend");
  });

  it("una categoría con 404 se saltea y queda en missingCategories, sin partialError", async () => {
    const fetchImpl = (async (url: string | URL | Request) =>
      String(url).includes("remote-design-jobs")
        ? new Response("no existe", { status: 404 })
        : new Response(xml)) as unknown as typeof fetch;
    for (const partialOnError of [false, true]) {
      const r = await fetchWwrJobs({
        since,
        categories: ["remote-programming-jobs", "remote-design-jobs"],
        fetchImpl,
        partialOnError,
      });
      expect(r.missingCategories).toEqual(["remote-design-jobs"]);
      expect(r.partialError).toBeNull();
      expect(r.errors).toEqual([]);
      expect(r.jobs).toHaveLength(3);
    }
  });

  it("si todas las categorías dan 404, tira con HTTP 404", async () => {
    await expect(
      fetchWwrJobs({
        since,
        categories: ["remote-design-jobs"],
        fetchImpl: xmlFetch({}, 404),
      }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it("las categorías específicas van antes que las generales", () => {
    expect(WWR_POOL_CATEGORIES.indexOf("remote-programming-jobs")).toBeGreaterThan(
      WWR_POOL_CATEGORIES.indexOf("remote-back-end-programming-jobs"),
    );
    expect(WWR_POOL_CATEGORIES.at(-1)).toBe("all-other-remote-jobs");
  });

  it("sin partialOnError, el primer error corta", async () => {
    await expect(
      fetchWwrJobs({
        since,
        categories: ["remote-back-end-programming-jobs", "remote-programming-jobs"],
        fetchImpl: (async (url: string | URL | Request) =>
          String(url).includes("back-end")
            ? new Response("x", { status: 500 })
            : new Response(xml)) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it("manda el user-agent cuando viene", async () => {
    const seenHeaders: Record<string, string>[] = [];
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      seenHeaders.push(init?.headers as Record<string, string>);
      return new Response(xml);
    }) as unknown as typeof fetch;
    await fetchWwrJobs({
      since,
      categories: ["remote-programming-jobs"],
      userAgent: "agente-ficticio/1.0",
      fetchImpl,
    });
    expect(seenHeaders[0]!["user-agent"]).toBe("agente-ficticio/1.0");
  });

  it("WWR_POOL_CATEGORIES: las 11 categorías con el patrón permitido", () => {
    expect(WWR_POOL_CATEGORIES).toHaveLength(11);
    for (const c of WWR_POOL_CATEGORIES) {
      expect(c).toMatch(/^(remote-[a-z-]+-jobs|all-other-remote-jobs)$/);
    }
  });

  it("una categoría que falla no corta las demás y queda en errors (partialOnError)", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).includes("remote-devops-sysadmin-jobs")) throw new Error("red caída");
      if (String(url).includes("remote-back-end-programming-jobs"))
        return new Response("x", { status: 500 });
      return new Response(xml, { status: 200 });
    }) as unknown as typeof fetch;
    const r = await fetchWwrJobs({
      since,
      categories: [
        "remote-back-end-programming-jobs",
        "remote-programming-jobs",
        "remote-devops-sysadmin-jobs",
      ],
      fetchImpl,
      partialOnError: true,
    });
    expect(r.jobs).toHaveLength(3);
    expect(r.partialError).toBe("http_5xx");
    expect(r.errors).toEqual([
      "We Work Remotely remote-back-end-programming-jobs: HTTP 500",
      "We Work Remotely remote-devops-sysadmin-jobs: red caída",
    ]);
  });

  it("entidad numérica fuera de rango no tumba el feed", () => {
    const bad = xml.replace("Empresa F: Backend Developer", "Empresa F: Dev &#99999999; &#xD800;x");
    const { items } = parseWwrFeed(bad);
    expect(items[1]!.title).toContain("&#99999999;");
  });

  it("HTTP no-OK en todas las categorías → error con fuente y status", async () => {
    await expect(
      fetchWwrJobs({
        since,
        categories: ["remote-programming-jobs"],
        fetchImpl: xmlFetch({}, 503),
      }),
    ).rejects.toThrow(/We Work Remotely remote-programming-jobs: HTTP 503/);
  });

  it("arma la URL del RSS por categoría", () => {
    expect(wwrCategoryUrl("https://x/categories", "remote-programming-jobs")).toBe(
      "https://x/categories/remote-programming-jobs.rss",
    );
  });
});
