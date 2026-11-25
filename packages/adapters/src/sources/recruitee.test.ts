import { describe, expect, it, vi } from "vitest";
import { atsBoardUrl, atsStatusOf } from "./ats-common";
import { fetchRecruiteeBoard, mapRecruiteeOffer } from "./recruitee";

const board = { token: "empresa-ficticia", companyName: "Empresa A" };

// Aviso inventado con la forma que se asume de la Careers Site API (a verificar con --dry-run)
const offer = (over: Record<string, unknown> = {}) => ({
  id: 1001,
  guid: "a1b2c3",
  status: "published",
  title: "Analista de Comunicación",
  description: "<p>Escribís y coordinás comunicados.</p>",
  requirements: "<ul><li>Redacción</li></ul>",
  location: "Rosario, Argentina",
  city: "Rosario",
  country: "Argentina",
  remote: true,
  hybrid: false,
  on_site: false,
  department: "Comunicación",
  employment_type_code: "fulltime",
  careers_url: "https://empresa-ficticia.recruitee.com/o/analista-de-comunicacion",
  careers_apply_url: "https://empresa-ficticia.recruitee.com/o/analista-de-comunicacion/c/new",
  published_at: "2026-11-10T12:00:00.000Z",
  created_at: "2026-11-01T12:00:00.000Z",
  tags: ["Prensa", "Redacción"],
  ...over,
});

const respond = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

const callsOf = (f: typeof fetch) =>
  (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;

describe("atsBoardUrl · recruitee", () => {
  it("el token va de subdominio, sin región, y tiene que ser una etiqueta DNS", () => {
    expect(atsBoardUrl("recruitee", "empresa-ficticia")).toBe(
      "https://empresa-ficticia.recruitee.com/api/offers/",
    );
    expect(() => atsBoardUrl("recruitee", "x", "eu")).toThrow("región inválida");
    for (const t of ["a.b", "a_b", "-a", "a-", "a/b", "a".repeat(64)]) {
      expect(() => atsBoardUrl("recruitee", t), t).toThrow("token inválido");
    }
  });
});

describe("fetchRecruiteeBoard", () => {
  it("mapea un aviso remoto declarado, con User-Agent propio y sin seguir redirecciones", async () => {
    const fetchImpl = respond({ offers: [offer()] });
    const r = await fetchRecruiteeBoard({
      ...board,
      userAgent: "Producto/1.0 (+https://sitio.example)",
      fetchImpl,
    });
    expect(r).toMatchObject({ status: "ok", seen: 1, skipped: 0, filteredNonRemote: 0 });
    const j = r.jobs[0]!;
    expect(j.source).toMatchObject({
      kind: "recruitee",
      name: "Recruitee",
      externalId: "recruitee:empresa-ficticia:1001",
      url: "https://empresa-ficticia.recruitee.com/o/analista-de-comunicacion",
    });
    expect(j).toMatchObject({
      title: "Analista de Comunicación",
      companyRaw: "Empresa A",
      locationRaw: "Rosario, Argentina",
      modality: "remoto",
      contractType: "fulltime",
      categories: ["Comunicación", "Prensa", "Redacción"],
      countriesAllowed: null,
      salaryMinUsd: null,
    });
    expect(j.jdText).toContain("Escribís y coordinás comunicados.");
    expect(j.jdText).toContain("Redacción");
    expect(j.jdText).not.toContain("<p>");
    expect(j.postedAt?.toISOString()).toBe("2026-11-10T12:00:00.000Z");
    const [url, init] = callsOf(fetchImpl)[0]!;
    expect(url).toBe("https://empresa-ficticia.recruitee.com/api/offers/");
    expect(init.redirect).toBe("error");
    expect((init.headers as Record<string, string>)["user-agent"]).toBe(
      "Producto/1.0 (+https://sitio.example)",
    );
    expect(callsOf(fetchImpl)).toHaveLength(1);
  });

  it("SOLO lo declarado cuenta como remoto: remote false, ausente o no booleano no entra", async () => {
    const r = await fetchRecruiteeBoard({
      ...board,
      fetchImpl: respond({
        offers: [
          offer({ id: 1 }),
          offer({ id: 2, remote: false }),
          offer({ id: 3, remote: undefined }),
          offer({ id: 4, remote: "true" }),
          offer({ id: 5, remote: false, location: "Remoto, Argentina" }),
        ],
      }),
    });
    expect(r.jobs.map((j) => j.source.externalId)).toEqual(["recruitee:empresa-ficticia:1"]);
    expect(r.filteredNonRemote).toBe(4);
  });

  it("falla cerrado por aviso: sin id, título, link en recruitee.com o fuera de `published` se saltea", async () => {
    const r = await fetchRecruiteeBoard({
      ...board,
      fetchImpl: respond({
        offers: [
          offer({ id: 1 }),
          offer({ id: undefined, guid: undefined }),
          offer({ id: 3, title: "  " }),
          offer({
            id: 4,
            careers_url: "https://recruitee.com.evil.example/o/x",
            careers_apply_url: "https://evil.example/o/x",
          }),
          offer({ id: 5, careers_url: "javascript:alert(1)", careers_apply_url: undefined }),
          offer({ id: 6, status: "draft" }),
          "no es un objeto",
          null,
        ],
      }),
    });
    expect(r.jobs.map((j) => j.source.externalId)).toEqual(["recruitee:empresa-ficticia:1"]);
    expect(r.skipped).toBe(7);
  });

  it("si `careers_url` es de otro host usa `careers_apply_url` del dominio de Recruitee", async () => {
    const r = await fetchRecruiteeBoard({
      ...board,
      fetchImpl: respond({
        offers: [offer({ careers_url: "https://evil.example/o/x" })],
      }),
    });
    expect(r.jobs[0]!.source.url).toBe(
      "https://empresa-ficticia.recruitee.com/o/analista-de-comunicacion/c/new",
    );
  });

  it("deduplica por id y mapea hybrid/on_site sin volverlos remotos", async () => {
    const r = await fetchRecruiteeBoard({
      ...board,
      fetchImpl: respond({ offers: [offer({ id: 1 }), offer({ id: 1, title: "Repetido" })] }),
    });
    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0]!.title).toBe("Analista de Comunicación");
    const hybrid = mapRecruiteeOffer(offer({ remote: false, hybrid: true }), board);
    expect(hybrid === "skip" || hybrid === "unlisted" ? null : hybrid.raw.modality).toBe("hibrido");
  });

  it("tope por board: quedan los más recientes y el resto cuenta en `truncated`", async () => {
    const offers = Array.from({ length: 205 }, (_, i) =>
      offer({
        id: i + 1,
        published_at: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString(),
      }),
    );
    const r = await fetchRecruiteeBoard({ ...board, fetchImpl: respond({ offers }) });
    expect(r.jobs).toHaveLength(200);
    expect(r.truncated).toBe(5);
    expect(r.jobs[0]!.source.externalId).toBe("recruitee:empresa-ficticia:205");
  });

  it("401 y 403 fallan cerrado: error `http_4xx`, un solo pedido (sin reintentos) y ningún aviso", async () => {
    for (const status of [401, 403]) {
      const fetchImpl = respond({ offers: [offer()] }, status);
      const err = await fetchRecruiteeBoard({ ...board, fetchImpl }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(atsStatusOf(err)).toBe("http_4xx");
      expect(callsOf(fetchImpl)).toHaveLength(1);
      expect((err as Error).message).not.toMatch(/offers|Analista/);
    }
  });

  it("una forma inesperada se descarta entera con `parse`", async () => {
    for (const body of [{}, { offers: "no" }, { offers: {} }, [], null, "texto"]) {
      const err = await fetchRecruiteeBoard({ ...board, fetchImpl: respond(body) }).catch(
        (e: unknown) => e,
      );
      expect(atsStatusOf(err), JSON.stringify(body)).toBe("parse");
    }
    const notJson = vi.fn(async () => new Response("<html>")) as unknown as typeof fetch;
    const err = await fetchRecruiteeBoard({ ...board, fetchImpl: notJson }).catch(
      (e: unknown) => e,
    );
    expect(atsStatusOf(err)).toBe("parse");
  });

  it("404 es `not_found` sin excepción; un 500 reintenta una vez y luego falla con http_5xx", async () => {
    const nf = await fetchRecruiteeBoard({ ...board, fetchImpl: respond({}, 404) });
    expect(nf).toMatchObject({ status: "not_found", jobs: [] });
    const fetchImpl = respond({}, 500);
    const err = await fetchRecruiteeBoard({ ...board, fetchImpl, sleep: async () => {} }).catch(
      (e: unknown) => e,
    );
    expect(atsStatusOf(err)).toBe("http_5xx");
    expect(callsOf(fetchImpl)).toHaveLength(2);
  });

  it("un token inválido falla antes de cualquier pedido", async () => {
    const fetchImpl = respond({ offers: [] });
    const err = await fetchRecruiteeBoard({ ...board, token: "a/../b", fetchImpl }).catch(
      (e: unknown) => e,
    );
    expect(atsStatusOf(err)).toBe("invalid_token");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
