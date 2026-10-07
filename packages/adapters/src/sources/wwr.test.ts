import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fetchWwrJobs, mapWwrJob, parseWwrFeed, wwrCategoryUrl } from "./wwr";

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
    expect(raw.source.kind).toBe("other");
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

  it("una categoría que falla no corta las demás y queda en errors", async () => {
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
    });
    expect(r.jobs).toHaveLength(3);
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
