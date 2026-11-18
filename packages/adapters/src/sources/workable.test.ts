import { describe, expect, it, vi } from "vitest";
import { atsStatusOf } from "./ats-common";
import { fetchWorkableBoard, mapWorkableJob } from "./workable";

const board = { token: "empresa-ficticia", companyName: "Empresa A" };

// Aviso inventado con la forma que se asume del widget (a verificar con --dry-run)
const posting = (over: Record<string, unknown> = {}) => ({
  title: "Analista de Contenidos",
  shortcode: "AB12CD34EF",
  employment_type: "Full-time",
  telecommuting: true,
  department: "Marketing",
  url: "https://apply.workable.com/empresa-ficticia/j/AB12CD34EF/",
  shortlink: "https://apply.workable.com/j/AB12CD34EF",
  application_url: "https://apply.workable.com/empresa-ficticia/j/AB12CD34EF/apply/",
  published_on: "2026-11-10",
  created_at: "2026-11-09",
  country: "Argentina",
  city: "Córdoba",
  state: "Córdoba",
  locations: [
    { country: "Argentina", countryCode: "AR", city: "Córdoba", region: "Córdoba", hidden: false },
  ],
  description: "<p>Escribís y coordinás contenidos.</p><ul><li>Redacción</li></ul>",
  ...over,
});

const respond = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

const callsOf = (f: typeof fetch) =>
  (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;

describe("fetchWorkableBoard", () => {
  it("mapea un aviso remoto declarado y pide la URL final del widget, sin seguir redirecciones", async () => {
    const fetchImpl = respond({ name: "Empresa A", jobs: [posting()] });
    const r = await fetchWorkableBoard({ ...board, fetchImpl });
    expect(r).toMatchObject({ status: "ok", seen: 1, skipped: 0, filteredNonRemote: 0 });
    const j = r.jobs[0]!;
    expect(j.source).toMatchObject({
      kind: "workable",
      name: "Workable",
      externalId: "workable:empresa-ficticia:AB12CD34EF",
      url: "https://apply.workable.com/empresa-ficticia/j/AB12CD34EF/",
    });
    expect(j).toMatchObject({
      title: "Analista de Contenidos",
      companyRaw: "Empresa A",
      locationRaw: "Córdoba, Córdoba, Argentina",
      modality: "remoto",
      contractType: "Full-time",
      categories: ["Marketing"],
      countriesAllowed: null,
      salaryMinUsd: null,
      salaryMaxUsd: null,
    });
    expect(j.jdText).toContain("Escribís y coordinás contenidos.");
    expect(j.jdText).not.toContain("<p>");
    expect(j.postedAt?.toISOString()).toBe("2026-11-10T00:00:00.000Z");
    const [url, init] = callsOf(fetchImpl)[0]!;
    expect(url).toBe(
      "https://apply.workable.com/api/v1/widget/accounts/empresa-ficticia?details=true",
    );
    expect(init.redirect).toBe("error");
  });

  it("SOLO lo declarado cuenta como remoto: telecommuting false, ausente o no booleano no entra", async () => {
    const r = await fetchWorkableBoard({
      ...board,
      fetchImpl: respond({
        jobs: [
          posting({ shortcode: "A1", telecommuting: false }),
          posting({ shortcode: "A2", telecommuting: undefined }),
          posting({ shortcode: "A3", telecommuting: "true" }),
          posting({ shortcode: "A4", telecommuting: null }),
          posting({ shortcode: "A5" }),
        ],
      }),
    });
    expect(r.jobs.map((j) => j.source.externalId)).toEqual(["workable:empresa-ficticia:A5"]);
    expect(r.filteredNonRemote).toBe(4);
  });

  it("el texto de la ubicación no vuelve remoto lo que la API no declara (ni «Remote» ni un país de LATAM)", async () => {
    const sinDato = (shortcode: string, extra: Record<string, unknown>) => {
      const { telecommuting: _t, ...rest } = posting({ shortcode, ...extra });
      return rest;
    };
    const r = await fetchWorkableBoard({
      ...board,
      fetchImpl: respond({
        jobs: [
          sinDato("B1", { city: "Remote", locations: [{ city: "Remote", country: "Argentina" }] }),
          sinDato("B2", { locations: [{ city: "Buenos Aires", country: "Argentina" }] }),
          sinDato("B3", { locations: [], city: "", state: "", country: "" }),
          posting({ shortcode: "B4", telecommuting: false, locations: [{ city: "Remote" }] }),
          sinDato("B5", { title: "Trabajo remoto en LATAM", locations: [{ country: "Anywhere" }] }),
        ],
      }),
    });
    expect(r.jobs).toEqual([]);
    expect(r.filteredNonRemote).toBe(5);
  });

  it("un remoto declarado sin ubicación entra, con ubicación y países en null", async () => {
    const r = await fetchWorkableBoard({
      ...board,
      fetchImpl: respond({
        jobs: [posting({ shortcode: "C1", locations: [], city: "", state: "", country: "" })],
      }),
    });
    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0]).toMatchObject({ locationRaw: null, countriesAllowed: null });
  });

  it("countriesAllowed queda null aunque la ubicación diga «Anywhere» o «Worldwide»", () => {
    const m = mapWorkableJob(
      posting({ locations: [{ country: "Worldwide" }], city: "", state: "", country: "" }),
      board,
    );
    if (m === "skip" || m === "unlisted") throw new Error("debería mapearse");
    expect(m.raw.countriesAllowed).toBeNull();
    expect(m.raw.locationRaw).toBe("Worldwide");
  });

  it("falla cerrado por aviso: sin id, sin título o sin link http(s) en workable.com se saltea", async () => {
    const r = await fetchWorkableBoard({
      ...board,
      fetchImpl: respond({
        jobs: [
          posting({ shortcode: "", id: undefined }),
          posting({ shortcode: "D2", title: "  " }),
          posting({
            shortcode: "D3",
            url: "https://sitio-ajeno.example/j/D3",
            shortlink: "",
            application_url: "",
          }),
          posting({
            shortcode: "D4",
            url: "javascript:alert(1)",
            shortlink: null,
            application_url: null,
          }),
          posting({
            shortcode: "D5",
            url: "https://workable.com.evil.example/j/D5",
            shortlink: undefined,
            application_url: undefined,
          }),
          posting({
            shortcode: "D6",
            url: undefined,
            shortlink: undefined,
            application_url: undefined,
          }),
          posting({ shortcode: "x".repeat(101) }),
          null,
          "texto",
          [],
          posting({ shortcode: "D9" }),
        ],
      }),
    });
    expect(r.jobs.map((j) => j.source.externalId)).toEqual(["workable:empresa-ficticia:D9"]);
    expect(r.skipped).toBe(10);
  });

  it("si `url` es de otro host usa `shortlink` o `application_url` del dominio de Workable", async () => {
    const r = await fetchWorkableBoard({
      ...board,
      fetchImpl: respond({
        jobs: [
          posting({ shortcode: "E1", url: "https://sitio-ajeno.example/E1" }),
          posting({
            shortcode: "E2",
            url: "https://sitio-ajeno.example/E2",
            shortlink: "https://sitio-ajeno.example/E2",
          }),
        ],
      }),
    });
    expect(r.jobs.map((j) => j.source.url)).toEqual([
      "https://apply.workable.com/j/AB12CD34EF",
      "https://apply.workable.com/empresa-ficticia/j/AB12CD34EF/apply/",
    ]);
  });

  it("ignora las ubicaciones ocultas y junta las demás sin repetir", () => {
    const m = mapWorkableJob(
      posting({
        locations: [
          { city: "Rosario", country: "Argentina" },
          { city: "Rosario", country: "Argentina" },
          { city: "Oculta", country: "Chile", hidden: true },
          { city: "Montevideo", country: "Uruguay" },
        ],
      }),
      board,
    );
    if (m === "skip" || m === "unlisted") throw new Error("debería mapearse");
    expect(m.raw.locationRaw).toBe("Rosario, Argentina; Montevideo, Uruguay");
  });

  it("una descripción con etiquetas escapadas queda en texto plano", () => {
    const m = mapWorkableJob(
      posting({ description: "&lt;p&gt;Hola &amp;amp; chau&lt;/p&gt;" }),
      board,
    );
    if (m === "skip" || m === "unlisted") throw new Error("debería mapearse");
    expect(m.raw.jdText).not.toMatch(/<\/?p>/);
    expect(m.raw.jdText).toContain("Hola");
  });

  it("repetidos por id: se queda con el primero", async () => {
    const r = await fetchWorkableBoard({
      ...board,
      fetchImpl: respond({
        jobs: [posting({ title: "Uno" }), posting({ title: "Dos" })],
      }),
    });
    expect(r.jobs.map((j) => j.title)).toEqual(["Uno"]);
  });

  it("una respuesta con forma inesperada se descarta entera (parse)", async () => {
    for (const body of [{ jobs: "no es lista" }, { items: [] }, [], "texto", null]) {
      const err = await fetchWorkableBoard({ ...board, fetchImpl: respond(body) }).catch(
        (e: unknown) => e,
      );
      expect(atsStatusOf(err), JSON.stringify(body)).toBe("parse");
    }
  });

  it("404 es not_found sin excepción; un 5xx falla con su código", async () => {
    const nf = await fetchWorkableBoard({ ...board, fetchImpl: respond({}, 404) });
    expect(nf).toMatchObject({ status: "not_found", jobs: [] });
    const err = await fetchWorkableBoard({
      ...board,
      fetchImpl: respond({}, 500),
      sleep: async () => {},
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
  });

  it("un token inválido falla antes de cualquier request", async () => {
    const fetchImpl = respond({ jobs: [] });
    const err = await fetchWorkableBoard({ ...board, token: "a/../b", fetchImpl }).catch(
      (e: unknown) => e,
    );
    expect(atsStatusOf(err)).toBe("invalid_token");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
