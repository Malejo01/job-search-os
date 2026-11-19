import { describe, expect, it } from "vitest";
import { sessionCookieConfig } from "../lib/session-cookie";

describe("sessionCookieConfig", () => {
  it("con https usa el prefijo __Host- y sus condiciones", () => {
    expect(sessionCookieConfig({ AUTH_URL: "https://app.example.com" })).toEqual({
      sessionToken: {
        name: "__Host-authjs.session-token",
        options: { httpOnly: true, sameSite: "lax", path: "/", secure: true },
      },
    });
  });

  it("no fija dominio: el prefijo lo prohíbe", () => {
    const config = sessionCookieConfig({ AUTH_URL: "https://app.example.com" });
    expect(config?.sessionToken.options).not.toHaveProperty("domain");
  });

  it.each([{ AUTH_URL: "http://localhost:3000" }, { AUTH_URL: "" }, {}])(
    "sin https deja la cookie por defecto: %j",
    (env) => {
      expect(sessionCookieConfig(env)).toBeUndefined();
    },
  );
});
