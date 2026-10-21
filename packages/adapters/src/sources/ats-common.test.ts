import { describe, expect, it, vi } from "vitest";
import { fetchGreenhouseBoard } from "./greenhouse";
import {
  ATS_MAX_JOBS_PER_BOARD,
  emptyBoardResult,
  atsBoardUrl,
  atsGetJson,
  atsGetText,
  atsHtmlToText,
  atsSalary,
  atsStatusOf,
  isValidAtsToken,
} from "./ats-common";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init });

describe("isValidAtsToken", () => {
  it("acepta slugs normales sin distinguir mayúsculas", () => {
    for (const t of ["empresa-ficticia", "Empresa_Ficticia.1", "a", "9abc"]) {
      expect(isValidAtsToken(t)).toBe(true);
    }
  });

  it("rechaza lo que podría cambiar la URL", () => {
    for (const t of [
      "",
      "-x",
      "a/b",
      "a?b=1",
      "a#b",
      "a@host",
      "a:80",
      "a b",
      "..",
      "a..b",
      "a".repeat(101),
      "empresa\n",
    ]) {
      expect(isValidAtsToken(t)).toBe(false);
    }
    expect(isValidAtsToken(undefined)).toBe(false);
  });
});

describe("atsBoardUrl", () => {
  it("arma las tres URLs fijas", () => {
    expect(atsBoardUrl("greenhouse", "empresa-ficticia")).toBe(
      "https://boards-api.greenhouse.io/v1/boards/empresa-ficticia/jobs?content=true",
    );
    expect(atsBoardUrl("lever", "empresa-ficticia")).toBe(
      "https://api.lever.co/v0/postings/empresa-ficticia?mode=json&limit=200",
    );
    expect(atsBoardUrl("ashby", "empresa-ficticia")).toBe(
      "https://api.ashbyhq.com/posting-api/job-board/empresa-ficticia?includeCompensation=true",
    );
  });

  it("Lever con región eu usa el host europeo", () => {
    expect(atsBoardUrl("lever", "empresa-ficticia", "eu")).toBe(
      "https://api.eu.lever.co/v0/postings/empresa-ficticia?mode=json&limit=200",
    );
  });

  it("cualquier otra región, o región en otro proveedor, es un error", () => {
    expect(() => atsBoardUrl("lever", "x", "evil.example")).toThrow();
    expect(() => atsBoardUrl("lever", "x", "us")).toThrow();
    expect(() => atsBoardUrl("greenhouse", "x", "eu")).toThrow();
    expect(atsBoardUrl("lever", "x", "")).toContain("api.lever.co");
    expect(atsBoardUrl("lever", "x", null)).toContain("api.lever.co");
  });

  it("Teamtailor: host fijo con el token de subdominio y región na", () => {
    expect(atsBoardUrl("teamtailor", "empresa-ficticia")).toBe(
      "https://empresa-ficticia.teamtailor.com/jobs.rss",
    );
    expect(atsBoardUrl("teamtailor", "empresa-ficticia", "na")).toBe(
      "https://empresa-ficticia.na.teamtailor.com/jobs.rss",
    );
    expect(atsBoardUrl("teamtailor", "x", "")).toBe("https://x.teamtailor.com/jobs.rss");
    expect(atsBoardUrl("teamtailor", "a".repeat(63))).toContain(`https://${"a".repeat(63)}.`);
  });

  it("Teamtailor: regiones inválidas; na solo en Teamtailor y eu solo en Lever", () => {
    for (const r of ["eu", "us", "NA", "na.evil.example", "x/y"]) {
      expect(() => atsBoardUrl("teamtailor", "x", r), r).toThrow("región inválida");
    }
    for (const p of ["greenhouse", "ashby", "lever"] as const) {
      expect(() => atsBoardUrl(p, "x", "na"), p).toThrow("región inválida");
    }
    expect(() => atsBoardUrl("greenhouse", "x", "eu")).toThrow("región inválida");
  });

  it("Teamtailor: el token tiene que ser una etiqueta DNS válida (anti-SSRF)", () => {
    for (const t of [
      "a.b",
      "a_b",
      "a/b",
      "a@b",
      "a:80",
      "Empresa",
      "eMPresa-1",
      "-a",
      "a-",
      "a".repeat(64),
      "a..b",
      "",
    ]) {
      expect(() => atsBoardUrl("teamtailor", t), t).toThrow("token inválido");
    }
    // Los otros proveedores siguen aceptando `.` y `_`
    expect(() => atsBoardUrl("lever", "a.b_c")).not.toThrow();
  });

  it("token inválido o proveedor desconocido lanza antes de armar nada", () => {
    expect(() => atsBoardUrl("lever", "a/../b")).toThrow("token inválido");
    expect(() => atsBoardUrl("otro" as never, "x")).toThrow();
  });
});

describe("atsGetJson", () => {
  it("manda User-Agent y Accept, y no sigue redirecciones", async () => {
    const fetchImpl = vi.fn(async () => json({ ok: 1 }));
    await atsGetJson("https://x.example/a", { fetchImpl: fetchImpl as never, userAgent: "UA/1" });
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toMatchObject({ accept: "application/json", "user-agent": "UA/1" });
    expect(init.redirect).toBe("error");
  });

  it("429 → un reintento con la espera de Retry-After (tope 10 s)", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "3" } }))
      .mockResolvedValueOnce(json({ ok: 1 }));
    await expect(atsGetJson("https://x.example/a", { fetchImpl, sleep })).resolves.toEqual({
      ok: 1,
    });
    expect(sleep).toHaveBeenCalledWith(3000);

    const sleep2 = vi.fn(async () => {});
    const f2 = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503, headers: { "retry-after": "999" } }))
      .mockResolvedValueOnce(json([]));
    await atsGetJson("https://x.example/a", { fetchImpl: f2, sleep: sleep2 });
    expect(sleep2).toHaveBeenCalledWith(10_000);
  });

  it("si el reintento también falla, error HTTP cerrado", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 500 }));
    const e = await atsGetJson("https://x.example/a", {
      fetchImpl: fetchImpl as never,
      sleep: async () => {},
    }).catch((err: unknown) => err);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(atsStatusOf(e)).toBe("http_5xx");
  });

  it("404 → not_found; otros 4xx → http_4xx sin reintento", async () => {
    const f404 = vi.fn(async () => new Response("", { status: 404 }));
    const e = await atsGetJson("https://x.example/a", { fetchImpl: f404 as never }).catch((x) => x);
    expect(atsStatusOf(e)).toBe("not_found");
    const f403 = vi.fn(async () => new Response("", { status: 403 }));
    const e2 = await atsGetJson("https://x.example/a", { fetchImpl: f403 as never }).catch(
      (x) => x,
    );
    expect(atsStatusOf(e2)).toBe("http_4xx");
    expect(f403).toHaveBeenCalledTimes(1);
  });

  it("respuesta de más de 15 MB (declarada o real) → too_large", async () => {
    const declared = vi.fn(
      async () => new Response("[]", { status: 200, headers: { "content-length": "99999999" } }),
    );
    const e = await atsGetJson("https://x.example/a", { fetchImpl: declared as never }).catch(
      (x) => x,
    );
    expect(atsStatusOf(e)).toBe("too_large");
    const big = vi.fn(async () => new Response(`["${"a".repeat(15 * 1024 * 1024)}"]`));
    const e2 = await atsGetJson("https://x.example/a", { fetchImpl: big as never }).catch((x) => x);
    expect(atsStatusOf(e2)).toBe("too_large");
  });

  it("cuerpo en chunks sin content-length → too_large; un stream infinito no se lee entero", async () => {
    let pulled = 0;
    const chunk = new Uint8Array(1024 * 1024).fill(97);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(chunk);
      },
    });
    const f = vi.fn(async () => new Response(stream, { status: 200 }));
    const e = await atsGetJson("https://x.example/a", { fetchImpl: f as never }).catch((x) => x);
    expect(atsStatusOf(e)).toBe("too_large");
    expect(pulled).toBeLessThan(20);
  });

  it("cuenta bytes, no caracteres: 8 M de 'ñ' (16 MB en UTF-8) superan el tope de 15 MB", async () => {
    const body = `["${"ñ".repeat(8 * 1024 * 1024)}"]`;
    const f = vi.fn(async () => new Response(body));
    const e = await atsGetJson("https://x.example/a", { fetchImpl: f as never }).catch((x) => x);
    expect(atsStatusOf(e)).toBe("too_large");
  });

  it("el timeout corta también la lectura del cuerpo", async () => {
    const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) });
    const f = vi.fn(async () => new Response(stream));
    const e = await atsGetJson("https://x.example/a", {
      fetchImpl: f as never,
      timeoutMs: 30,
    }).catch((x) => x);
    expect(atsStatusOf(e)).toBe("timeout");
  });

  it("Retry-After mayor a lo que le queda a la fuente: no duerme y falla con su código", async () => {
    const sleep = vi.fn(async () => {});
    const f = vi.fn(async () => new Response("", { status: 429, headers: { "retry-after": "8" } }));
    const e = await atsGetJson("https://x.example/a", {
      fetchImpl: f as never,
      sleep,
      timeLeftMs: () => 5_000,
    }).catch((x) => x);
    expect(atsStatusOf(e)).toBe("http_429");
    expect(sleep).not.toHaveBeenCalled();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("con presupuesto suficiente sí espera y reintenta", async () => {
    const sleep = vi.fn(async () => {});
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(json({ ok: 1 }));
    await atsGetJson("https://x.example/a", { fetchImpl: f, sleep, timeLeftMs: () => 20_000 });
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("cuerpo que no es JSON → parse, sin el fragmento del cuerpo", async () => {
    const f = vi.fn(async () => new Response("<html>secreto</html>"));
    const e = await atsGetJson("https://x.example/a", { fetchImpl: f as never }).catch((x) => x);
    expect(atsStatusOf(e)).toBe("parse");
    expect(String((e as Error).message)).not.toContain("secreto");
  });

  it("una request colgada corta por timeout", async () => {
    const never = (() => new Promise(() => {})) as unknown as typeof fetch;
    const e = await atsGetJson("https://x.example/a", { fetchImpl: never, timeoutMs: 20 }).catch(
      (x) => x,
    );
    expect(atsStatusOf(e)).toBe("timeout");
  });
});

describe("atsGetText", () => {
  const xml = "<rss><channel></channel></rss>";

  it("200 → el cuerpo como texto, con Accept de RSS, User-Agent y sin seguir redirecciones", async () => {
    const f = vi.fn(async () => new Response(xml));
    await expect(
      atsGetText("https://x.example/jobs.rss", { fetchImpl: f as never, userAgent: "UA/1" }),
    ).resolves.toBe(xml);
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toMatchObject({
      accept: expect.stringContaining("application/rss+xml"),
      "user-agent": "UA/1",
    });
    expect(init.redirect).toBe("error");
  });

  it("404 → not_found", async () => {
    const f = vi.fn(async () => new Response("", { status: 404 }));
    const e = await atsGetText("https://x.example/a", { fetchImpl: f as never }).catch((x) => x);
    expect(atsStatusOf(e)).toBe("not_found");
  });

  it("429 → un reintento tras Retry-After", async () => {
    const sleep = vi.fn(async () => {});
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "4" } }))
      .mockResolvedValueOnce(new Response(xml));
    await expect(atsGetText("https://x.example/a", { fetchImpl: f, sleep })).resolves.toBe(xml);
    expect(sleep).toHaveBeenCalledWith(4000);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("cuerpo por encima del tope → too_large", async () => {
    const big = vi.fn(async () => new Response("a".repeat(15 * 1024 * 1024 + 1)));
    const e = await atsGetText("https://x.example/a", { fetchImpl: big as never }).catch((x) => x);
    expect(atsStatusOf(e)).toBe("too_large");
  });
});

describe("atsHtmlToText", () => {
  it("decodifica HTML escapado y lo pasa a texto", () => {
    expect(
      atsHtmlToText(
        "&lt;p&gt;Hola &amp;amp; chau&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Uno&lt;/li&gt;&lt;/ul&gt;",
      ),
    ).toBe("Hola & chau\n- Uno");
  });

  it("HTML normal también", () => {
    expect(atsHtmlToText("<p>Hola</p><p>Mundo</p>")).toBe("Hola\nMundo");
    expect(atsHtmlToText(null)).toBe("");
  });
});

describe("atsSalary", () => {
  it("USD con período claro llena los números", () => {
    expect(
      atsSalary({
        min: 1000,
        max: 2000,
        currency: "usd",
        interval: "per-month-salary",
        sourceName: "X",
      }),
    ).toEqual({
      salaryMinUsd: 1000,
      salaryMaxUsd: 2000,
      salaryPeriod: "mensual",
      salaryNote: null,
    });
  });

  it("otra moneda o período dudoso va a la nota", () => {
    const eur = atsSalary({ min: 1, max: 2, currency: "EUR", interval: "1 YEAR", sourceName: "X" });
    expect(eur.salaryMinUsd).toBeNull();
    expect(eur.salaryNote).toContain("EUR");
    const week = atsSalary({
      min: 1,
      max: 2,
      currency: "USD",
      interval: "per-week",
      sourceName: "X",
    });
    expect(week.salaryPeriod).toBeNull();
    expect(week.salaryNote).toContain("USD");
  });

  it("sin números no hay nada", () => {
    expect(atsSalary({ currency: "USD", interval: "year", sourceName: "X" }).salaryNote).toBeNull();
  });
});

describe("tope por board (ATS_MAX_JOBS_PER_BOARD)", () => {
  const DAY = 86_400_000;
  const T0 = Date.UTC(2026, 9, 1);
  const item = (id: number, publishedMs: number | null) => ({
    id,
    title: "Backend Engineer",
    absolute_url: `https://boards.example.test/empresa-ficticia/jobs/${id}`,
    location: { name: "Remote" },
    first_published: publishedMs === null ? null : new Date(publishedMs).toISOString(),
    updated_at: null,
    content: "texto",
  });
  const run = (items: unknown[]) =>
    fetchGreenhouseBoard({
      token: "empresa-ficticia",
      companyName: "Empresa Ficticia 1",
      fetchImpl: vi.fn(
        async () => new Response(JSON.stringify({ jobs: items })),
      ) as unknown as typeof fetch,
    });
  const idsOf = (jobs: { source: { externalId?: string | null } }[]) =>
    jobs.map((j) => Number(j.source.externalId?.split(":")[2]));

  it("500 remotos: salen 200, truncated = 300, los más recientes; sin fecha al final", async () => {
    // ids 1..450 con fecha creciente (el id mayor es el más reciente), 451..500 sin fecha
    const items = [
      ...Array.from({ length: 450 }, (_, i) => item(i + 1, T0 + i * DAY)),
      ...Array.from({ length: 50 }, (_, i) => item(451 + i, null)),
    ];
    const r = await run(items);
    expect(r.status).toBe("ok");
    expect(r.jobs).toHaveLength(ATS_MAX_JOBS_PER_BOARD);
    expect(r.truncated).toBe(300);
    const ids = idsOf(r.jobs);
    expect(ids[0]).toBe(450);
    expect(ids[ids.length - 1]).toBe(251);
    expect(ids.some((id) => id > 450)).toBe(false);
  });

  it("los sin fecha completan el cupo al final, en el orden de la respuesta", async () => {
    const items = [
      ...Array.from({ length: 150 }, (_, i) => item(i + 1, T0 + i * DAY)),
      ...Array.from({ length: 100 }, (_, i) => item(1001 + i, null)),
    ];
    const r = await run(items);
    expect(r.truncated).toBe(50);
    const ids = idsOf(r.jobs);
    expect(ids[0]).toBe(150);
    expect(ids.slice(150)).toEqual(Array.from({ length: 50 }, (_, i) => 1001 + i));
  });

  it("hasta el tope: truncated = 0 y el orden de la respuesta no cambia", async () => {
    const r = await run([item(1, T0), item(2, T0 + DAY)]);
    expect(r.truncated).toBe(0);
    expect(idsOf(r.jobs)).toEqual([1, 2]);
  });

  it("emptyBoardResult inicia truncated en 0", () => {
    expect(emptyBoardResult("not_found").truncated).toBe(0);
  });
});
