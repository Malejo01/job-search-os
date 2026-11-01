import { describe, expect, it } from "vitest";
import { resetUrlBase } from "./reset-url";

describe("resetUrlBase", () => {
  it("SITE_URL gana sobre AUTH_URL y NEXT_PUBLIC_APP_URL (C3-4)", () => {
    expect(
      resetUrlBase({
        SITE_URL: "https://afiniajobs.com.ar/",
        AUTH_URL: "https://viejo.example",
        NEXT_PUBLIC_APP_URL: "https://otra.example",
        NODE_ENV: "production",
      }),
    ).toEqual({ ok: true, url: "https://afiniajobs.com.ar" });
  });

  it("un SITE_URL que no es una URL se ignora y vale el respaldo de siempre", () => {
    expect(
      resetUrlBase({
        SITE_URL: "afiniajobs",
        AUTH_URL: "https://app.example",
        NODE_ENV: "production",
      }),
    ).toEqual({ ok: true, url: "https://app.example" });
    expect(resetUrlBase({ SITE_URL: "javascript:alert(1)", NODE_ENV: "production" }).ok).toBe(
      false,
    );
  });

  it("prefiere AUTH_URL y quita la barra final", () => {
    expect(
      resetUrlBase({
        AUTH_URL: "https://app.example/",
        NEXT_PUBLIC_APP_URL: "https://otra.example",
      }),
    ).toEqual({ ok: true, url: "https://app.example" });
  });

  it("usa NEXT_PUBLIC_APP_URL si no hay AUTH_URL", () => {
    expect(
      resetUrlBase({ NEXT_PUBLIC_APP_URL: "https://app.example", NODE_ENV: "production" }),
    ).toEqual({ ok: true, url: "https://app.example" });
  });

  it("en desarrollo sin configuración cae a localhost", () => {
    expect(resetUrlBase({ NODE_ENV: "development" })).toEqual({
      ok: true,
      url: "http://localhost:3000",
    });
    expect(resetUrlBase({})).toEqual({ ok: true, url: "http://localhost:3000" });
  });

  it("en producción sin configuración devuelve error", () => {
    const out = resetUrlBase({ NODE_ENV: "production", AUTH_URL: "  " });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toMatch(/SITE_URL/);
  });
});
