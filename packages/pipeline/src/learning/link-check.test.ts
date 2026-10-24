import { describe, expect, it } from "vitest";
import {
  classifyLinkCheck,
  isCheckableUrl,
  nextLinkHealth,
  sameSite,
  type LinkStep,
} from "./link-check";

const st = (status: number): LinkStep => ({ status });

describe("classifyLinkCheck", () => {
  it("2xx es ok", () => {
    expect(classifyLinkCheck([st(200)], false)).toBe("ok");
    expect(classifyLinkCheck([st(206)], false)).toBe("ok");
  });

  it("3xx que termina en 2xx en otra ruta es moved", () => {
    expect(classifyLinkCheck([st(301), st(200)], true)).toBe("moved");
  });

  it("3xx que termina en 2xx en la misma ruta es ok (http a https)", () => {
    expect(classifyLinkCheck([st(301), st(200)], false)).toBe("ok");
  });

  it("404 y 410 son gone", () => {
    expect(classifyLinkCheck([st(404)], false)).toBe("gone");
    expect(classifyLinkCheck([st(410)], false)).toBe("gone");
    expect(classifyLinkCheck([st(302), st(404)], true)).toBe("gone");
  });

  it("401, 403 y 429 son blocked", () => {
    for (const s of [401, 403, 429]) expect(classifyLinkCheck([st(s)], false)).toBe("blocked");
  });

  it("5xx, timeout, red, URL insegura y demasiados saltos son error", () => {
    expect(classifyLinkCheck([st(500)], false)).toBe("error");
    expect(classifyLinkCheck([st(503)], false)).toBe("error");
    for (const failure of ["timeout", "network", "unsafe_url", "too_many_redirects"] as const) {
      expect(classifyLinkCheck([{ failure }], false)).toBe("error");
    }
    expect(classifyLinkCheck([st(301), { failure: "unsafe_url" }], true)).toBe("error");
  });

  it("más de 3 saltos es error aunque termine en 200", () => {
    expect(classifyLinkCheck([st(301), st(301), st(301), st(301), st(200)], true)).toBe("error");
  });

  it("falla cerrado: casos no previstos dan error, nunca ok", () => {
    expect(classifyLinkCheck([], false)).toBe("error");
    expect(classifyLinkCheck([st(418)], false)).toBe("error");
    expect(classifyLinkCheck([st(100)], false)).toBe("error");
    expect(classifyLinkCheck([st(302)], true)).toBe("error"); // terminó en un salto
    expect(classifyLinkCheck([st(200), st(200)], false)).toBe("error"); // 2xx en el medio
    expect(classifyLinkCheck([st(Number.NaN)], false)).toBe("error");
  });
});

describe("nextLinkHealth", () => {
  const now = "2026-10-26T12:00:00.000Z";
  const daysAgo = (n: number) => new Date(Date.parse(now) - n * 86_400_000).toISOString();

  it("la primera falla suma 1 y todavía no es broken", () => {
    const r = nextLinkHealth({ consecutiveFailures: 0, lastFailureAt: null }, "gone", now);
    expect(r).toEqual({ consecutiveFailures: 1, lastFailureAt: now, broken: false });
  });

  it("con 7 días suma y queda broken", () => {
    const r = nextLinkHealth({ consecutiveFailures: 1, lastFailureAt: daysAgo(7) }, "error", now);
    expect(r).toEqual({ consecutiveFailures: 2, lastFailureAt: now, broken: true });
  });

  it("con 6 días no suma otra vez", () => {
    const prev = { consecutiveFailures: 1, lastFailureAt: daysAgo(6) };
    const r = nextLinkHealth(prev, "gone", now);
    expect(r).toEqual({ consecutiveFailures: 1, lastFailureAt: prev.lastFailureAt, broken: false });
  });

  it("ok y moved vuelven a 0", () => {
    for (const s of ["ok", "moved"] as const) {
      const r = nextLinkHealth({ consecutiveFailures: 3, lastFailureAt: daysAgo(10) }, s, now);
      expect(r).toEqual({ consecutiveFailures: 0, lastFailureAt: null, broken: false });
    }
  });

  it("blocked y skipped no tocan nada", () => {
    const prev = { consecutiveFailures: 2, lastFailureAt: daysAgo(10) };
    for (const s of ["blocked", "skipped"] as const) {
      expect(nextLinkHealth(prev, s, now)).toEqual({ ...prev, broken: true });
    }
  });

  it("una fecha ilegible cuenta como falla nueva", () => {
    const r = nextLinkHealth({ consecutiveFailures: 1, lastFailureAt: "no-es-fecha" }, "gone", now);
    expect(r.consecutiveFailures).toBe(2);
  });
});

describe("nextLinkHealth con un now ilegible", () => {
  it("no suma ni guarda el now inválido", () => {
    const prev = { consecutiveFailures: 1, lastFailureAt: "2026-10-01T12:00:00.000Z" };
    expect(nextLinkHealth(prev, "gone", "no-es-una-fecha")).toEqual({ ...prev, broken: false });
  });
});

describe("sameSite", () => {
  it("mismo host, o el mismo con y sin www, es el mismo sitio", () => {
    expect(sameSite("https://example.com/a", "https://example.com/b")).toBe(true);
    expect(sameSite("http://example.com/a", "https://www.example.com/a")).toBe(true);
    expect(sameSite("https://WWW.Example.com/", "https://example.com/x")).toBe(true);
  });

  it("otro host, un subdominio distinto o una URL ilegible no lo son", () => {
    expect(sameSite("https://example.com/a", "https://otro.example/a")).toBe(false);
    expect(sameSite("https://example.com/a", "https://docs.example.com/a")).toBe(false);
    expect(sameSite("https://example.com/a", "no es url")).toBe(false);
  });
});

describe("isCheckableUrl", () => {
  it("acepta https y http públicos", () => {
    expect(isCheckableUrl("https://docs.example.com/curso/intro")).toBe(true);
    expect(isCheckableUrl("http://example.com/")).toBe(true);
  });

  it("rechaza otros esquemas, credenciales y texto que no es URL", () => {
    expect(isCheckableUrl("ftp://example.com/a")).toBe(false);
    expect(isCheckableUrl("javascript:alert(1)")).toBe(false);
    expect(isCheckableUrl("file:///etc/passwd")).toBe(false);
    expect(isCheckableUrl("https://user:pass@example.com/")).toBe(false);
    expect(isCheckableUrl("https://user@example.com/")).toBe(false);
    expect(isCheckableUrl("no es una url")).toBe(false);
    expect(isCheckableUrl("")).toBe(false);
  });

  it.each([
    "http://localhost/",
    "http://app.localhost/",
    "http://impresora.local/",
    "http://db.internal/",
    "http://10.0.0.1/",
    "http://127.0.0.1/",
    "http://127.1.2.3/",
    "http://169.254.169.254/latest",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://0.0.0.0/",
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://[fd12:3456::1]/",
    "http://[fe80::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://2130706433/", // 127.0.0.1 en decimal
    "http://0x7f000001/", // hexadecimal
    "http://0177.0.0.1/", // octal
    "http://servidor/", // una sola etiqueta
  ])("rechaza el host privado o raro %s", (url) => {
    expect(isCheckableUrl(url)).toBe(false);
  });

  it("no rechaza de más: 172.32 y 11.x son públicas", () => {
    expect(isCheckableUrl("http://172.32.0.1/")).toBe(true);
    expect(isCheckableUrl("http://11.0.0.1/")).toBe(true);
  });
});
