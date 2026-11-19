import { NextRequest, NextResponse, type NextFetchEvent } from "next/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Las páginas públicas siguen estáticas: un nonce en la CSP las obligaría a renderizarse por pedido. Este test
 * fija que el middleware solo pone la CSP con nonce a las rutas privadas y que los headers de seguridad de
 * siempre llegan a las dos clases de ruta (los pone next.config.ts con un patrón que cubre todo).
 */

// Auth.js decide primero en el middleware real; acá deja pasar todo para mirar solo lo que suma la CSP.
vi.mock("next-auth", () => ({
  default: () => ({ auth: async () => NextResponse.next() }),
}));
vi.mock("../auth.config", () => ({ authConfig: {} }));
// next.config.ts carga el entorno local y los redirects del dominio viejo: no hacen falta acá.
vi.mock("@job-search-os/db", () => ({ loadLocalEnv: () => {} }));
vi.mock("@job-search-os/pipeline", () => ({ legacyHostRedirects: () => [] }));

import middleware from "../middleware";
import nextConfig from "../next.config";
import { appliesNonceCsp } from "../lib/csp";
import { SECURITY_HEADERS } from "../lib/security-headers";

const PUBLIC_PATHS = [
  "/",
  "/acceso",
  "/precios",
  "/ayuda",
  "/mercado",
  "/mercado/backend",
  "/ofertas",
  "/ofertas/backend",
  "/legal/privacidad",
  "/legal/terminos",
  "/login",
  "/register",
  "/setup",
  "/forgot-password",
  "/reset-password",
  "/demo",
  "/demo/contaduria",
  "/como-esta-hecho",
  "/en/how-its-built",
  "/sitemap.xml",
  "/robots.txt",
];
const PRIVATE_PATHS = ["/hoy", "/jobs", "/jobs/123", "/inbox", "/settings", "/settings/perfil", "/cv/perfil"];

const run = (path: string) =>
  middleware(new NextRequest(`https://app.example${path}`), {} as NextFetchEvent);

describe("la CSP con nonce solo llega a las rutas privadas", () => {
  it.each(PUBLIC_PATHS)("%s no recibe CSP con nonce", async (path) => {
    expect(appliesNonceCsp(path)).toBe(false);
    const response = await run(path);
    expect(response?.headers.get("content-security-policy-report-only")).toBeNull();
    // Tampoco se reenvía al render: Next tomaría el nonce de ahí y la página dejaría de ser estática
    expect(response?.headers.get("x-middleware-request-content-security-policy-report-only")).toBeNull();
  });

  it.each(PRIVATE_PATHS)("%s recibe la CSP con nonce", async (path) => {
    expect(appliesNonceCsp(path)).toBe(true);
    const response = await run(path);
    const policy = response?.headers.get("content-security-policy-report-only") ?? "";
    expect(policy).toMatch(/script-src [^;]*'nonce-[A-Za-z0-9+/=]{20,}'/);
    expect(response?.headers.get("x-middleware-request-content-security-policy-report-only")).toBe(policy);
  });

  it("cada pedido privado recibe un nonce distinto", async () => {
    const first = (await run("/hoy"))?.headers.get("content-security-policy-report-only");
    const second = (await run("/hoy"))?.headers.get("content-security-policy-report-only");
    expect(first).not.toBe(second);
  });

  it("una ruta pública escrita con otra forma tampoco recibe nonce", async () => {
    for (const path of ["/LOGIN", "/mercado/", "//acceso"]) {
      expect(appliesNonceCsp(path)).toBe(false);
    }
  });

  it("una ruta privada escrita con otra forma sigue recibiendo nonce", async () => {
    for (const path of ["/%6Aobs", "/HOY", "/hoy/"]) {
      expect(appliesNonceCsp(path)).toBe(true);
    }
  });
});

describe("los headers de seguridad de siempre llegan a las dos clases de ruta", () => {
  it("next.config.ts los pone con un patrón que cubre todas las rutas", async () => {
    const entries = await nextConfig.headers!();
    const global = entries.find((e) => e.source === "/:path*");
    expect(global).toBeDefined();
    expect(global!.headers).toEqual([...SECURITY_HEADERS]);
  });

  it("incluyen HSTS, COOP y los demás", () => {
    const keys = SECURITY_HEADERS.map((h) => h.key);
    for (const key of [
      "Strict-Transport-Security",
      "Cross-Origin-Opener-Policy",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Content-Security-Policy",
    ]) {
      expect(keys).toContain(key);
    }
  });

  it("la CSP global no lleva nonce: no vuelve dinámica ninguna página", () => {
    const csp = SECURITY_HEADERS.find((h) => h.key === "Content-Security-Policy")?.value ?? "";
    expect(csp).not.toMatch(/nonce/i);
  });

  it("el middleware no pisa ni saca headers de seguridad de las rutas públicas", async () => {
    const response = await run("/precios");
    expect(response?.headers.get("content-security-policy")).toBeNull();
  });
});
