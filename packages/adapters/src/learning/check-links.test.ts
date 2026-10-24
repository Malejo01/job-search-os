import { describe, expect, it, vi } from "vitest";
import { checkLearningLink, checkLearningLinks } from "./check-links";

type Reply = { status: number; location?: string } | Error;

/** fetch falso: responde en orden y anota los pedidos. Sin red. */
function fakeFetch(replies: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const cancel = vi.fn(async () => undefined);
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const reply = replies.shift();
    if (!reply) throw new Error("sin respuesta preparada");
    if (reply instanceof Error) throw reply;
    const headers = new Headers();
    if (reply.location) headers.set("location", reply.location);
    return { status: reply.status, headers, body: { cancel } } as unknown as Response;
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls, cancel };
}

const opts = (fetchImpl: typeof fetch) => ({ fetchImpl, userAgent: "TestAgent/1.0" });

describe("checkLearningLink", () => {
  it("HEAD 200 es ok, con los encabezados y sin seguir redirecciones", async () => {
    const f = fakeFetch([{ status: 200 }]);
    const r = await checkLearningLink("https://example.com/curso", opts(f.fetchImpl));
    expect(r).toEqual({ status: "ok", resolvedUrl: null });
    expect(f.calls).toHaveLength(1);
    const { init } = f.calls[0]!;
    expect(init.method).toBe("HEAD");
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const h = new Headers(init.headers);
    expect(h.get("user-agent")).toBe("TestAgent/1.0");
    expect(h.get("accept")).toBe("text/html");
    expect(f.cancel).toHaveBeenCalled();
  });

  it("301 a 200 en otra ruta es moved y trae resolvedUrl", async () => {
    const f = fakeFetch([{ status: 301, location: "/nuevo/curso" }, { status: 200 }]);
    const r = await checkLearningLink("https://example.com/viejo", opts(f.fetchImpl));
    expect(r).toEqual({ status: "moved", resolvedUrl: "https://example.com/nuevo/curso" });
    expect(f.calls[1]!.url).toBe("https://example.com/nuevo/curso");
  });

  it("http a https en la misma ruta es ok y sin resolvedUrl", async () => {
    const f = fakeFetch([{ status: 301, location: "https://example.com/curso" }, { status: 200 }]);
    const r = await checkLearningLink("http://example.com/curso", opts(f.fetchImpl));
    expect(r).toEqual({ status: "ok", resolvedUrl: null });
  });

  it("4 saltos es error", async () => {
    const f = fakeFetch([
      { status: 302, location: "/a" },
      { status: 302, location: "/b" },
      { status: 302, location: "/c" },
      { status: 302, location: "/d" },
      { status: 200 },
    ]);
    const r = await checkLearningLink("https://example.com/", opts(f.fetchImpl));
    expect(r).toEqual({ status: "error", resolvedUrl: null });
  });

  it("3 saltos todavía se aceptan", async () => {
    const f = fakeFetch([
      { status: 302, location: "/a" },
      { status: 302, location: "/b" },
      { status: 302, location: "/c" },
      { status: 200 },
    ]);
    const r = await checkLearningLink("https://example.com/", opts(f.fetchImpl));
    expect(r.status).toBe("moved");
  });

  it("un salto a una IP local es error y no se pide", async () => {
    const f = fakeFetch([{ status: 302, location: "http://127.0.0.1/admin" }, { status: 200 }]);
    const r = await checkLearningLink("https://example.com/", opts(f.fetchImpl));
    expect(r).toEqual({ status: "error", resolvedUrl: null });
    expect(f.calls.map((c) => c.url)).toEqual(["https://example.com/"]);
  });

  it("una URL insegura de entrada es error sin ningún pedido", async () => {
    const f = fakeFetch([]);
    const r = await checkLearningLink("http://192.168.0.5/", opts(f.fetchImpl));
    expect(r).toEqual({ status: "error", resolvedUrl: null });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it("un 3xx sin Location es error", async () => {
    const f = fakeFetch([{ status: 302 }]);
    expect((await checkLearningLink("https://example.com/", opts(f.fetchImpl))).status).toBe(
      "error",
    );
  });

  it("405 hace un único GET con Range y cancela el cuerpo", async () => {
    const f = fakeFetch([{ status: 405 }, { status: 206 }]);
    const r = await checkLearningLink("https://example.com/", opts(f.fetchImpl));
    expect(r.status).toBe("ok");
    expect(f.calls.map((c) => c.init.method)).toEqual(["HEAD", "GET"]);
    expect(new Headers(f.calls[1]!.init.headers).get("range")).toBe("bytes=0-0");
    expect(f.cancel).toHaveBeenCalledTimes(2);
  });

  it("501 también cae al GET, y si el GET da 405 no insiste", async () => {
    const f = fakeFetch([{ status: 501 }, { status: 405 }]);
    const r = await checkLearningLink("https://example.com/", opts(f.fetchImpl));
    expect(r.status).toBe("error");
    expect(f.calls).toHaveLength(2);
  });

  it("el GET se hace una sola vez aunque redirija y el HEAD siguiente dé 405", async () => {
    const f = fakeFetch([
      { status: 405 },
      { status: 302, location: "/otra" },
      { status: 405 },
      { status: 206 },
    ]);
    const r = await checkLearningLink("https://example.com/", opts(f.fetchImpl));
    expect(r.status).toBe("error");
    expect(f.calls.map((c) => c.init.method)).toEqual(["HEAD", "GET", "HEAD"]);
  });

  it("un salto a otro dominio no se pide: queda blocked, para revisión humana", async () => {
    const f = fakeFetch([{ status: 301, location: "https://otro.example/curso" }, { status: 200 }]);
    const r = await checkLearningLink("https://example.com/curso", opts(f.fetchImpl));
    expect(r).toEqual({ status: "blocked", resolvedUrl: null });
    expect(f.calls.map((c) => c.url)).toEqual(["https://example.com/curso"]);
  });

  it("de example.com a www.example.com sí se sigue", async () => {
    const f = fakeFetch([
      { status: 301, location: "https://www.example.com/curso" },
      { status: 200 },
    ]);
    const r = await checkLearningLink("https://example.com/curso", opts(f.fetchImpl));
    expect(r.status).toBe("ok");
    expect(f.calls).toHaveLength(2);
  });

  it("timeout es error", async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener("abort", () =>
            rej(Object.assign(new Error("abortado"), { name: "AbortError" })),
          );
        }),
    ) as unknown as typeof fetch;
    const r = await checkLearningLink("https://example.com/", {
      fetchImpl,
      userAgent: "T",
      timeoutMs: 10,
    });
    expect(r).toEqual({ status: "error", resolvedUrl: null });
  });

  it("un error de red es error", async () => {
    const f = fakeFetch([new Error("ECONNRESET")]);
    expect((await checkLearningLink("https://example.com/", opts(f.fetchImpl))).status).toBe(
      "error",
    );
  });

  it("403 es blocked, 404 es gone, 500 es error", async () => {
    for (const [status, expected] of [
      [403, "blocked"],
      [404, "gone"],
      [500, "error"],
    ] as const) {
      const f = fakeFetch([{ status }]);
      expect((await checkLearningLink("https://example.com/", opts(f.fetchImpl))).status).toBe(
        expected,
      );
    }
  });
});

describe("checkLearningLinks", () => {
  const item = (id: string, checkMode: "auto" | "manual" = "auto") => ({
    id,
    url: `https://example.com/${id}`,
    checkMode,
  });

  it("manual da skipped sin pedido y devuelve cantidades por código", async () => {
    const f = fakeFetch([{ status: 200 }, { status: 404 }]);
    const sleep = vi.fn(async () => undefined);
    const r = await checkLearningLinks([item("a"), item("m", "manual"), item("b")], {
      ...opts(f.fetchImpl),
      sleep,
    });
    expect(r.results.map((x) => [x.id, x.status])).toEqual([
      ["a", "ok"],
      ["m", "skipped"],
      ["b", "gone"],
    ]);
    expect(r.counts).toMatchObject({ ok: 1, gone: 1, skipped: 1, error: 0, moved: 0, blocked: 0 });
    expect(f.fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1); // entre pedidos reales, no antes del primero
    expect(sleep).toHaveBeenCalledWith(300);
  });

  it("se corta al llegar a max", async () => {
    const f = fakeFetch([{ status: 200 }, { status: 200 }, { status: 200 }]);
    const r = await checkLearningLinks([item("a"), item("b"), item("c")], {
      ...opts(f.fetchImpl),
      max: 2,
      sleep: async () => undefined,
    });
    expect(r.results.map((x) => x.id)).toEqual(["a", "b"]);
    expect(r.truncated).toBe(true);
    expect(f.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("se corta al agotar el presupuesto", async () => {
    const f = fakeFetch([{ status: 200 }, { status: 200 }, { status: 200 }]);
    let t = 0;
    const r = await checkLearningLinks([item("a"), item("b"), item("c")], {
      ...opts(f.fetchImpl),
      budgetMs: 1000,
      now: () => t,
      sleep: async () => {
        t += 600; // cada pausa gasta 600 ms del presupuesto
      },
    });
    // a: t=0 pasa; pausa a 600; b: pasa; pausa a 1200; c: ya se pasó
    expect(r.results.map((x) => x.id)).toEqual(["a", "b"]);
    expect(r.truncated).toBe(true);
  });

  it("sin cortes no marca truncated", async () => {
    const f = fakeFetch([{ status: 200 }]);
    const r = await checkLearningLinks([item("a")], {
      ...opts(f.fetchImpl),
      sleep: async () => undefined,
    });
    expect(r.truncated).toBe(false);
  });
});
