import { describe, expect, it } from "vitest";
import { resetUrlBase } from "./reset-url";

describe("resetUrlBase", () => {
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
    expect(resetUrlBase({ NODE_ENV: "production", AUTH_URL: "  " }).ok).toBe(false);
  });
});
