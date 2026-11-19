import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { appliesNonceCsp, createNonce, reportOnlyPolicy, themeScriptHash } from "../lib/csp";
import { SECURITY_HEADERS } from "../lib/security-headers";
import { THEME_SCRIPT_SOURCE } from "../lib/theme-script-source";

const directive = (policy: string, name: string) =>
  policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));

describe("reportOnlyPolicy", () => {
  const policy = reportOnlyPolicy("nonce-de-prueba", "hash-de-prueba");

  it("los scripts necesitan el nonce o el hash del tema", () => {
    const scripts = directive(policy, "script-src");
    expect(scripts).toContain("'nonce-nonce-de-prueba'");
    expect(scripts).toContain("'sha256-hash-de-prueba'");
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
  });

  it.each([
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
    ["default-src", "'self'"],
  ])("fija %s", (name, value) => {
    expect(directive(policy, name)).toBe(`${name} ${value}`);
  });
});

describe("themeScriptHash", () => {
  it("coincide con el hash del script del tema", async () => {
    const expected = createHash("sha256").update(THEME_SCRIPT_SOURCE, "utf8").digest("base64");
    await expect(themeScriptHash()).resolves.toBe(expected);
  });
});

describe("createNonce", () => {
  it("cambia en cada pedido y sirve dentro de la política", () => {
    const first = createNonce();
    expect(first).not.toBe(createNonce());
    expect(first).toMatch(/^[A-Za-z0-9+/=]{20,}$/);
  });
});

describe("appliesNonceCsp", () => {
  it.each(["/hoy", "/jobs/123", "/settings", "/cv/perfil", "/onboarding"])(
    "aplica en la ruta privada %s",
    (path) => {
      expect(appliesNonceCsp(path)).toBe(true);
    },
  );

  it.each(["/", "/login", "/mercado/backend", "/legal/terminos", "/precios", "/api/assistant"])(
    "no aplica en %s, para no volver dinámica una página pública",
    (path) => {
      expect(appliesNonceCsp(path)).toBe(false);
    },
  );
});

describe("SECURITY_HEADERS", () => {
  const value = (key: string) => SECURITY_HEADERS.find((h) => h.key === key)?.value;

  it("fija HSTS sin preload", () => {
    expect(value("Strict-Transport-Security")).toBe("max-age=31536000");
  });

  it("aísla la ventana de otros sitios", () => {
    expect(value("Cross-Origin-Opener-Policy")).toBe("same-origin");
  });

  it("conserva los headers que ya existían", () => {
    expect(value("X-Content-Type-Options")).toBe("nosniff");
    expect(value("X-Frame-Options")).toBe("DENY");
    expect(value("Content-Security-Policy")).toBe("frame-ancestors 'none'");
  });
});
