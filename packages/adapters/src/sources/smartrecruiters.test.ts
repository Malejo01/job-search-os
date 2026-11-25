import { describe, expect, it, vi } from "vitest";
import { atsBoardUrl, atsStatusOf } from "./ats-common";
import {
  fetchSmartRecruitersBoard,
  SMARTRECRUITERS_MAX_DETAILS,
  SMARTRECRUITERS_MAX_PAGES,
} from "./smartrecruiters";

const board = { token: "EmpresaFicticia", companyName: "Empresa A" };
const LIST = "https://api.smartrecruiters.com/v1/companies/EmpresaFicticia/postings";

// Avisos inventados con la forma que se asume de la Posting API (a verificar con --dry-run)
const listed = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Analista Legal ${id}`,
  releasedDate: "2026-11-10T12:00:00.000Z",
  location: { city: "Buenos Aires", region: "BA", country: "ar", remote: true },
  department: { label: "Legales" },
  function: { label: "Legal" },
  typeOfEmployment: { label: "Full-time" },
  ...over,
});

const detail = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Analista Legal ${id}`,
  releasedDate: "2026-11-10T12:00:00.000Z",
  postingUrl: `https://jobs.smartrecruiters.com/EmpresaFicticia/${id}-analista-legal`,
  location: {
    city: "Buenos Aires",
    country: "ar",
    remote: true,
    fullLocation: "Buenos Aires, Argentina",
  },
  jobAd: {
    sections: {
      companyDescription: { title: "Empresa", text: "<p>Somos Empresa A.</p>" },
      jobDescription: { title: "Puesto", text: "<p>Revisás contratos.</p>" },
      qualifications: { title: "Perfil", text: "<ul><li>Abogacía</li></ul>" },
    },
  },
  ...over,
});

type Routes = {
  pages?: unknown[][];
  totalFound?: number;
  details?: Record<string, unknown | number>;
  listStatus?: number;
};

/** `fetch` falso: la lista se parte en páginas de 100 según `offset`; el detalle sale de `details[id]`. */
function api(routes: Routes) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const u = new URL(url);
    if (u.pathname.endsWith("/postings")) {
      if (routes.listStatus) return new Response("{}", { status: routes.listStatus });
      const offset = Number(u.searchParams.get("offset") ?? "0");
      const content = routes.pages?.[offset / 100] ?? [];
      return new Response(
        JSON.stringify({ offset, limit: 100, totalFound: routes.totalFound ?? 0, content }),
      );
    }
    const id = decodeURIComponent(u.pathname.split("/").pop()!);
    const d = routes.details?.[id];
    if (typeof d === "number") return new Response("{}", { status: d });
    return new Response(JSON.stringify(d ?? detail(id)));
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("atsBoardUrl · smartrecruiters", () => {
  it("usa el id de la empresa en la ruta, con `limit` y sin región", () => {
    expect(atsBoardUrl("smartrecruiters", "EmpresaFicticia")).toBe(`${LIST}?limit=100`);
    expect(() => atsBoardUrl("smartrecruiters", "x", "eu")).toThrow("región inválida");
    for (const t of ["a/b", "a b", "a?x", "a#x", "a:b", "a@b", "..", "a..b", ""]) {
      expect(() => atsBoardUrl("smartrecruiters", t), t).toThrow("token inválido");
    }
  });
});

describe("fetchSmartRecruitersBoard", () => {
  it("lista + detalle de un aviso remoto declarado, con User-Agent propio y sin redirecciones", async () => {
    const { fetchImpl, calls } = api({ pages: [[listed("101")]], totalFound: 1 });
    const r = await fetchSmartRecruitersBoard({
      ...board,
      userAgent: "Producto/1.0 (+https://sitio.example)",
      fetchImpl,
    });
    expect(r).toMatchObject({
      status: "ok",
      seen: 1,
      skipped: 0,
      filteredNonRemote: 0,
      truncated: 0,
    });
    const j = r.jobs[0]!;
    expect(j.source).toMatchObject({
      kind: "smartrecruiters",
      name: "SmartRecruiters",
      externalId: "smartrecruiters:EmpresaFicticia:101",
      url: "https://jobs.smartrecruiters.com/EmpresaFicticia/101-analista-legal",
    });
    expect(j).toMatchObject({
      title: "Analista Legal 101",
      companyRaw: "Empresa A",
      locationRaw: "Buenos Aires, Argentina",
      modality: "remoto",
      contractType: "Full-time",
      categories: ["Legales", "Legal"],
      countriesAllowed: null,
    });
    expect(j.jdText).toContain("Somos Empresa A.");
    expect(j.jdText).toContain("Revisás contratos.");
    expect(j.jdText).toContain("Abogacía");
    expect(j.jdText).not.toContain("<p>");
    expect(calls).toEqual([`${LIST}?limit=100&offset=0`, `${LIST}/101`]);
    const init = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]![1];
    expect(init.redirect).toBe("error");
    expect((init.headers as Record<string, string>)["user-agent"]).toBe(
      "Producto/1.0 (+https://sitio.example)",
    );
  });

  it("SOLO lo declarado cuenta como remoto, y los no remotos no piden detalle", async () => {
    const { fetchImpl, calls } = api({
      pages: [
        [
          listed("1"),
          listed("2", { location: { city: "Córdoba", remote: false } }),
          listed("3", { location: { city: "Córdoba" } }),
          listed("4", { location: { remote: "true" } }),
          listed("5", { location: undefined }),
        ],
      ],
      totalFound: 5,
    });
    const r = await fetchSmartRecruitersBoard({ ...board, fetchImpl });
    expect(r.jobs.map((j) => j.source.externalId)).toEqual(["smartrecruiters:EmpresaFicticia:1"]);
    expect(r.filteredNonRemote).toBe(4);
    expect(calls.filter((c) => !c.includes("offset="))).toEqual([`${LIST}/1`]);
  });

  it("pagina de a 100 y corta en `totalFound`; nunca más de SMARTRECRUITERS_MAX_PAGES páginas", async () => {
    const page = (from: number) =>
      Array.from({ length: 100 }, (_, i) =>
        listed(String(from + i), { location: { remote: false } }),
      );
    const { fetchImpl, calls } = api({
      pages: [page(0), page(100), page(200), page(300)],
      totalFound: 400,
    });
    const r = await fetchSmartRecruitersBoard({ ...board, fetchImpl });
    expect(SMARTRECRUITERS_MAX_PAGES).toBe(3);
    expect(calls.filter((c) => c.includes("offset="))).toEqual([
      `${LIST}?limit=100&offset=0`,
      `${LIST}?limit=100&offset=100`,
      `${LIST}?limit=100&offset=200`,
    ]);
    expect(r.seen).toBe(300);

    const short = api({
      pages: [page(0), [listed("999", { location: { remote: false } })]],
      totalFound: 101,
    });
    await fetchSmartRecruitersBoard({ ...board, fetchImpl: short.fetchImpl });
    expect(short.calls.filter((c) => c.includes("offset="))).toHaveLength(2);
  });

  it("tope de detalles por corrida: pide solo los más recientes y el resto cuenta en `truncated`", async () => {
    const n = SMARTRECRUITERS_MAX_DETAILS + 7;
    const content = Array.from({ length: n }, (_, i) =>
      listed(String(i + 1), {
        releasedDate: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString(),
      }),
    );
    const { fetchImpl, calls } = api({ pages: [content], totalFound: n });
    const r = await fetchSmartRecruitersBoard({ ...board, fetchImpl });
    expect(r.jobs).toHaveLength(SMARTRECRUITERS_MAX_DETAILS);
    expect(r.truncated).toBe(7);
    const detailCalls = calls.filter((c) => !c.includes("offset="));
    expect(detailCalls).toHaveLength(SMARTRECRUITERS_MAX_DETAILS);
    expect(detailCalls[0]).toBe(`${LIST}/${n}`);
    expect(calls.length).toBeLessThanOrEqual(
      SMARTRECRUITERS_MAX_PAGES + SMARTRECRUITERS_MAX_DETAILS,
    );
  });

  it("sin descripción o sin postingUrl de smartrecruiters.com no se ingesta; un detalle 404 saltea solo ese aviso", async () => {
    const { fetchImpl } = api({
      pages: [[listed("1"), listed("2"), listed("3"), listed("4"), listed("5")]],
      totalFound: 5,
      details: {
        "1": detail("1"),
        "2": detail("2", { jobAd: { sections: {} } }),
        "3": detail("3", { postingUrl: "https://smartrecruiters.com.evil.example/x" }),
        "4": 404,
        "5": detail("5", { postingUrl: undefined }),
      },
    });
    const r = await fetchSmartRecruitersBoard({ ...board, fetchImpl });
    expect(r.jobs.map((j) => j.source.externalId)).toEqual(["smartrecruiters:EmpresaFicticia:1"]);
    expect(r.skipped).toBe(4);
  });

  it("ids con caracteres de ruta no se piden: falla cerrado por aviso", async () => {
    const { fetchImpl, calls } = api({
      pages: [[listed("../../x"), listed("a/b"), listed("1?x=1"), listed("7")]],
      totalFound: 4,
    });
    const r = await fetchSmartRecruitersBoard({ ...board, fetchImpl });
    expect(r.jobs.map((j) => j.source.externalId)).toEqual(["smartrecruiters:EmpresaFicticia:7"]);
    expect(r.skipped).toBe(3);
    expect(calls.filter((c) => !c.includes("offset="))).toEqual([`${LIST}/7`]);
  });

  it("un detalle que falla por otra causa corta el board entero: sin avisos parciales", async () => {
    for (const status of [401, 403, 429, 500]) {
      const { fetchImpl } = api({
        pages: [[listed("1"), listed("2")]],
        totalFound: 2,
        details: { "1": detail("1"), "2": status },
      });
      const err = await fetchSmartRecruitersBoard({
        ...board,
        fetchImpl,
        sleep: async () => {},
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(atsStatusOf(err), String(status)).toBe(
        status === 429 ? "http_429" : status >= 500 ? "http_5xx" : "http_4xx",
      );
    }
  });

  it("401 y 403 en la lista fallan cerrado con http_4xx y un solo pedido", async () => {
    for (const listStatus of [401, 403]) {
      const { fetchImpl, calls } = api({ listStatus });
      const err = await fetchSmartRecruitersBoard({ ...board, fetchImpl }).catch((e: unknown) => e);
      expect(atsStatusOf(err)).toBe("http_4xx");
      expect(calls).toHaveLength(1);
    }
  });

  it("404 en la primera página es `not_found` sin excepción", async () => {
    const { fetchImpl } = api({ listStatus: 404 });
    const r = await fetchSmartRecruitersBoard({ ...board, fetchImpl });
    expect(r).toMatchObject({ status: "not_found", jobs: [] });
  });

  it("una página con forma inesperada se descarta entera con `parse`", async () => {
    for (const body of [{}, { content: "no" }, { content: {} }, [], null, "texto"]) {
      const fetchImpl = vi.fn(
        async () => new Response(JSON.stringify(body)),
      ) as unknown as typeof fetch;
      const err = await fetchSmartRecruitersBoard({ ...board, fetchImpl }).catch((e: unknown) => e);
      expect(atsStatusOf(err), JSON.stringify(body)).toBe("parse");
    }
  });

  it("un token inválido falla antes de cualquier pedido", async () => {
    const { fetchImpl, calls } = api({});
    const err = await fetchSmartRecruitersBoard({ ...board, token: "a/../b", fetchImpl }).catch(
      (e: unknown) => e,
    );
    expect(atsStatusOf(err)).toBe("invalid_token");
    expect(calls).toHaveLength(0);
  });
});
