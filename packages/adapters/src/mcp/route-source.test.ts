import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// MCP-1. Test sobre el código fuente de apps/web (la ruta importa "@/lib/..." y la base, así que no se
// puede cargar acá; mismo enfoque que packages/db/src/health-route.test.ts). Fija dos cosas que un
// cambio chico podría romper sin que falle nada más: que no vuelva un usuario cacheado entre requests y
// que el token o la URL del request (que lo lleva en ?token=) no terminen en un log ni en un error.
// El comportamiento lo cubren el e2e 124 (por HTTP) y mcp-tokens.integration.test.ts (en la base).
const read = (path: string) =>
  readFileSync(new URL(`../../../../apps/web/${path}`, import.meta.url), "utf8");

const FILES = {
  route: read("app/api/mcp/route.ts"),
  user: read("lib/mcp-user.ts"),
  tokens: read("lib/mcp-tokens.ts"),
  actions: read("app/(app)/settings/conexiones/actions.ts"),
};

/** Sin comentarios, para que una mención en la documentación no cuente como código. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("MCP sin caché de usuario entre requests (MCP-1)", () => {
  it("lib/mcp-user.ts no tiene estado de módulo mutable", () => {
    const src = code(FILES.user);
    expect(src).not.toMatch(/^(let|var) /m);
    expect(src).not.toContain("cachedUserId");
    expect(src).not.toMatch(/globalThis/);
  });

  it("la ruta tampoco guarda el usuario fuera del request", () => {
    const src = code(FILES.route);
    expect(src).not.toMatch(/^(let|var) /m);
    expect(src).not.toContain("resolveMcpUserId");
    // Cada tool toma el usuario del request
    expect(src.match(/mcpUserIdFor\(ctx\.http\?\.authInfo\)/g)).toHaveLength(11);
  });
});

describe("el token no se loguea ni vuelve en un error (MCP-1)", () => {
  it("ninguno de los archivos del MCP escribe en consola ni crea un logger", () => {
    for (const [name, src] of Object.entries(FILES)) {
      expect(code(src), name).not.toMatch(/console\.|createLogger|logger\./);
    }
  });

  it("req.url solo se usa para leer ?token= (nunca se arma un mensaje con la URL)", () => {
    const route = code(FILES.route);
    const user = code(FILES.user);
    expect(route).not.toContain("req.url");
    expect(user.match(/req\.url/g)).toEqual(["req.url"]);
    expect(user).toContain("url: req.url,");
  });

  it("el principal que viaja a las tools no lleva el token y las fallas son genéricas", () => {
    const route = code(FILES.route);
    expect(route).toContain('token: "",');
    expect(route).toContain('json(401, { error: "no autorizado" })');
    expect(route).toContain('json(429, { error: "demasiadas llamadas" }');
    // Un error de la base al resolver el token no se propaga con detalle
    expect(code(FILES.user)).toMatch(/catch \{\s*return UNAUTHORIZED;/);
  });

  it("el token en claro solo sale de la acción que lo crea, nunca de la lista", () => {
    const tokens = code(FILES.tokens);
    // listMcpTokens no selecciona el hash
    const list = tokens.slice(
      tokens.indexOf("listMcpTokens"),
      tokens.indexOf("CreateMcpTokenResult"),
    );
    expect(list).not.toContain("tokenHash");
    expect(code(FILES.actions)).toContain("mcpConnectorUrl(siteUrl(), created.token)");
  });
});
