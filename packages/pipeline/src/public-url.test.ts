import { describe, expect, it } from "vitest";
import { legacyHostRedirects, parseLegacyHosts, siteOrigin } from "./public-url";

describe("siteOrigin · la URL pública sale de SITE_URL (C3-4)", () => {
  it("devuelve el origen: sin barra final, sin ruta y sin parámetros", () => {
    expect(siteOrigin({ SITE_URL: "https://afiniajobs.com.ar" })).toBe("https://afiniajobs.com.ar");
    expect(siteOrigin({ SITE_URL: " https://afiniajobs.com.ar/ " })).toBe(
      "https://afiniajobs.com.ar",
    );
    expect(siteOrigin({ SITE_URL: "https://afiniajobs.com.ar/precios?x=1#a" })).toBe(
      "https://afiniajobs.com.ar",
    );
  });

  it("acepta http (desarrollo), pero no otro esquema ni texto suelto", () => {
    expect(siteOrigin({ SITE_URL: "http://localhost:3000" })).toBe("http://localhost:3000");
    for (const bad of [
      "ftp://x.test",
      "javascript:alert(1)",
      "afiniajobs.com.ar",
      "",
      "  ",
      "//x.test",
    ]) {
      expect(siteOrigin({ SITE_URL: bad })).toBeNull();
    }
    expect(siteOrigin({})).toBeNull();
  });

  it("no acepta credenciales en la URL", () => {
    expect(
      siteOrigin({ SITE_URL: ["https://", "u", ":", "p", "@", "afiniajobs.com.ar"].join("") }),
    ).toBeNull();
  });
});

describe("parseLegacyHosts · los dominios viejos", () => {
  it("lee una lista separada por comas, en minúscula y sin repetir", () => {
    expect(
      parseLegacyHosts(
        " Busquedalaboral.Malejo.com.ar , job-search-os-kohl.vercel.app,busquedalaboral.malejo.com.ar",
      ),
    ).toEqual(["busquedalaboral.malejo.com.ar", "job-search-os-kohl.vercel.app"]);
  });

  it("descarta lo que no es un nombre de host: esquemas, rutas, puertos, comodines y vacíos", () => {
    expect(
      parseLegacyHosts(
        "https://viejo.test,viejo.test/ruta,viejo.test:3000,*.viejo.test,,  ,a b.test,-x.test",
      ),
    ).toEqual([]);
    expect(parseLegacyHosts(undefined)).toEqual([]);
  });

  it("tiene un tope de hosts", () => {
    const many = Array.from({ length: 30 }, (_, i) => `h${i}.test`).join(",");
    expect(parseLegacyHosts(many).length).toBe(10);
  });
});

describe("legacyHostRedirects · redirecciones del dominio viejo al nuevo (C3-4)", () => {
  const env = {
    SITE_URL: "https://afiniajobs.com.ar",
    LEGACY_HOSTS: "busquedalaboral.malejo.com.ar,job-search-os-kohl.vercel.app",
  };

  it("sin LEGACY_HOSTS o sin SITE_URL no hay ninguna redirección", () => {
    expect(legacyHostRedirects({ SITE_URL: env.SITE_URL })).toEqual([]);
    expect(legacyHostRedirects({ LEGACY_HOSTS: env.LEGACY_HOSTS })).toEqual([]);
    expect(
      legacyHostRedirects({ SITE_URL: "no es una url", LEGACY_HOSTS: env.LEGACY_HOSTS }),
    ).toEqual([]);
    expect(legacyHostRedirects({})).toEqual([]);
  });

  it("arma dos reglas por host: la portada y el resto, siempre permanentes y hacia el sitio nuevo", () => {
    const rules = legacyHostRedirects(env);
    expect(rules).toHaveLength(4);
    for (const rule of rules) {
      expect(rule.permanent).toBe(true);
      expect(rule.destination.startsWith("https://afiniajobs.com.ar/")).toBe(true);
      expect(rule.has).toEqual([{ type: "host", value: expect.any(String) }]);
    }
    const first = rules.filter((r) => r.has[0]!.value === "busquedalaboral\\.malejo\\.com\\.ar");
    expect(first.map((r) => r.source)).toEqual(["/", "/:path((?!api/|_next/).+)"]);
    expect(first.map((r) => r.destination)).toEqual([
      "https://afiniajobs.com.ar/",
      "https://afiniajobs.com.ar/:path",
    ]);
  });

  it("nunca redirige /api ni /_next: el webhook, los crons y el MCP siguen andando en el host viejo", () => {
    const rules = legacyHostRedirects(env);
    // El patrón de Next es «/:path(<regex>)»: se prueba la regex tal cual, anclada después de la «/»
    const inner = /^\/:path\((.*)\)$/.exec(rules[1]!.source)![1]!;
    const matcher = new RegExp(`^/${inner}$`);
    expect(matcher.test("/precios")).toBe(true);
    expect(matcher.test("/mercado/data_analyst")).toBe(true);
    expect(matcher.test("/api/inbound")).toBe(false);
    expect(matcher.test("/api/cron/ingest")).toBe(false);
    expect(matcher.test("/_next/static/x.js")).toBe(false);
    // Una página que solo empieza parecido a «api» sí se redirige
    expect(matcher.test("/apiario")).toBe(true);
  });

  it("no redirige el host nuevo a sí mismo aunque esté en la lista", () => {
    expect(
      legacyHostRedirects({
        SITE_URL: "https://afiniajobs.com.ar",
        LEGACY_HOSTS: "afiniajobs.com.ar",
      }),
    ).toEqual([]);
  });

  it("escapa los puntos del host para que no coincida con otro dominio", () => {
    const [rule] = legacyHostRedirects({
      SITE_URL: "https://nuevo.test",
      LEGACY_HOSTS: "a.b.test",
    });
    expect(rule!.has[0]!.value).toBe("a\\.b\\.test");
    expect(new RegExp(`^${rule!.has[0]!.value}$`).test("axb.test")).toBe(false);
    expect(new RegExp(`^${rule!.has[0]!.value}$`).test("a.b.test")).toBe(true);
  });
});
