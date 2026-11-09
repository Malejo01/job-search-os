import { describe, expect, it } from "vitest";
import {
  checkMcpToken,
  classifyMcpCredential,
  extractMcpToken,
  generateMcpUserToken,
  hashMcpToken,
  isMcpUserToken,
  MCP_TOKEN_LABEL_MAX,
  MCP_USER_TOKEN_TTL_MS,
  mcpConnectorUrl,
  mcpUserTokensEnabled,
  normalizeMcpTokenLabel,
} from "./auth";

const URL_BASE = "https://app.example/api/mcp";
const base = { authorization: null, url: URL_BASE, expected: "tok-test-123", allowQuery: false };

describe("checkMcpToken", () => {
  it("acepta Bearer válido (cualquier capitalización del esquema)", () => {
    expect(checkMcpToken({ ...base, authorization: "Bearer tok-test-123" })).toBe(true);
    expect(checkMcpToken({ ...base, authorization: "bearer tok-test-123" })).toBe(true);
  });

  it("rechaza Bearer incorrecto o de otro largo", () => {
    expect(checkMcpToken({ ...base, authorization: "Bearer tok-test-124" })).toBe(false);
    expect(checkMcpToken({ ...base, authorization: "Bearer corto" })).toBe(false);
  });

  it("rechaza sin credenciales", () => {
    expect(checkMcpToken(base)).toBe(false);
    expect(checkMcpToken({ ...base, authorization: "Basic tok-test-123" })).toBe(false);
  });

  it("falla cerrado sin MCP_TOKEN, aunque el cliente mande un token vacío", () => {
    expect(checkMcpToken({ ...base, expected: undefined, authorization: "Bearer " })).toBe(false);
    expect(checkMcpToken({ ...base, expected: "", authorization: "Bearer x" })).toBe(false);
    expect(
      checkMcpToken({ ...base, expected: "", url: `${URL_BASE}?token=`, allowQuery: true }),
    ).toBe(false);
  });

  it("?token= se ignora si allowQuery es false", () => {
    expect(checkMcpToken({ ...base, url: `${URL_BASE}?token=tok-test-123` })).toBe(false);
  });

  it("?token= se acepta con allowQuery", () => {
    const url = `${URL_BASE}?token=tok-test-123`;
    expect(checkMcpToken({ ...base, url, allowQuery: true })).toBe(true);
    expect(checkMcpToken({ ...base, url: `${URL_BASE}?token=otro-token!`, allowQuery: true })).toBe(
      false,
    );
  });

  it("un Bearer incorrecto no cae al ?token= válido", () => {
    expect(
      checkMcpToken({
        ...base,
        authorization: "Bearer mal",
        url: `${URL_BASE}?token=tok-test-123`,
        allowQuery: true,
      }),
    ).toBe(false);
  });
});

// MCP-1: tokens personales. Valores de prueba armados a mano, sin forma de token real.
const FAKE_USER_TOKEN = `afj_${"A".repeat(43)}`;

describe("generateMcpUserToken / hashMcpToken (MCP-1)", () => {
  it("prefijo afj_ + 32 bytes en base64url (43 caracteres), hash sha256 hex y vence a los 30 días", () => {
    const now = new Date("2026-11-09T12:00:00Z");
    const t = generateMcpUserToken(now);
    expect(t.token).toMatch(/^afj_[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(t.token.slice(4), "base64url")).toHaveLength(32);
    expect(t.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.tokenHash).toBe(hashMcpToken(t.token));
    expect(t.tokenHash).not.toContain(t.token.slice(4));
    expect(t.expiresAt.getTime() - now.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
    expect(MCP_USER_TOKEN_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("dos tokens nunca son iguales", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateMcpUserToken().token));
    expect(seen.size).toBe(200);
  });

  it("el hash es determinístico y distinto por token", () => {
    expect(hashMcpToken(FAKE_USER_TOKEN)).toBe(hashMcpToken(FAKE_USER_TOKEN));
    expect(hashMcpToken(FAKE_USER_TOKEN)).not.toBe(hashMcpToken(`afj_${"B".repeat(43)}`));
  });
});

describe("isMcpUserToken (MCP-1)", () => {
  it("reconoce solo el formato exacto", () => {
    expect(isMcpUserToken(FAKE_USER_TOKEN)).toBe(true);
    expect(isMcpUserToken(generateMcpUserToken().token)).toBe(true);
    expect(isMcpUserToken("afj_")).toBe(false);
    expect(isMcpUserToken(`afj_${"A".repeat(42)}`)).toBe(false);
    expect(isMcpUserToken(`afj_${"A".repeat(44)}`)).toBe(false);
    expect(isMcpUserToken(`AFJ_${"A".repeat(43)}`)).toBe(false);
    expect(isMcpUserToken(`afj_${"A".repeat(42)}=`)).toBe(false);
    expect(isMcpUserToken("tok-test-123")).toBe(false);
  });
});

describe("extractMcpToken (MCP-1)", () => {
  const q = (token: string) => `${URL_BASE}?token=${encodeURIComponent(token)}`;

  it("Bearer gana; el query no se mira si hay Bearer", () => {
    expect(extractMcpToken({ authorization: "Bearer uno", url: q("dos"), allowQuery: true })).toBe(
      "uno",
    );
  });

  it("?token= solo con allowQuery", () => {
    expect(extractMcpToken({ authorization: null, url: q("dos"), allowQuery: false })).toBeNull();
    expect(extractMcpToken({ authorization: null, url: q("dos"), allowQuery: true })).toBe("dos");
  });

  it("sin credencial, Basic, Bearer vacío o URL rota: null", () => {
    expect(extractMcpToken({ authorization: null, url: URL_BASE, allowQuery: true })).toBeNull();
    expect(
      extractMcpToken({ authorization: "Basic x", url: URL_BASE, allowQuery: false }),
    ).toBeNull();
    expect(
      extractMcpToken({ authorization: "Bearer   ", url: URL_BASE, allowQuery: false }),
    ).toBeNull();
    expect(extractMcpToken({ authorization: null, url: "no es url", allowQuery: true })).toBeNull();
    expect(extractMcpToken({ authorization: null, url: q(""), allowQuery: true })).toBeNull();
  });
});

describe("mcpUserTokensEnabled (MCP-1)", () => {
  it("solo con MCP_USER_TOKENS=testers; cualquier otro valor falla cerrado", () => {
    expect(mcpUserTokensEnabled({ MCP_USER_TOKENS: "testers" })).toBe(true);
    expect(mcpUserTokensEnabled({ MCP_USER_TOKENS: " testers " })).toBe(true);
    for (const v of [undefined, "", "1", "all", "Testers", "tester", "true"]) {
      expect(mcpUserTokensEnabled({ MCP_USER_TOKENS: v })).toBe(false);
    }
  });
});

describe("classifyMcpCredential (MCP-1)", () => {
  const shared = "tok-test-123";
  const input = (over: Partial<Parameters<typeof classifyMcpCredential>[0]>) => ({
    authorization: null,
    url: URL_BASE,
    allowQuery: false,
    sharedToken: shared,
    userTokens: true,
    ...over,
  });

  it("MCP_TOKEN sigue igual: Bearer o ?token= (con allowQuery) → shared", () => {
    expect(classifyMcpCredential(input({ authorization: `Bearer ${shared}` }))).toEqual({
      kind: "shared",
    });
    expect(
      classifyMcpCredential(input({ url: `${URL_BASE}?token=${shared}`, allowQuery: true })),
    ).toEqual({ kind: "shared" });
    // Sin tokens personales, MCP_TOKEN no cambia
    expect(
      classifyMcpCredential(input({ authorization: `Bearer ${shared}`, userTokens: false })),
    ).toEqual({ kind: "shared" });
  });

  it("token personal con el modo encendido → hash, nunca el token en claro", () => {
    const out = classifyMcpCredential(input({ authorization: `Bearer ${FAKE_USER_TOKEN}` }));
    expect(out).toEqual({ kind: "user", tokenHash: hashMcpToken(FAKE_USER_TOKEN) });
    expect(JSON.stringify(out)).not.toContain(FAKE_USER_TOKEN);
    expect(
      classifyMcpCredential(
        input({ url: `${URL_BASE}?token=${FAKE_USER_TOKEN}`, allowQuery: true }),
      ),
    ).toEqual({ kind: "user", tokenHash: hashMcpToken(FAKE_USER_TOKEN) });
  });

  it("sin MCP_USER_TOKENS=testers el token personal falla cerrado", () => {
    expect(
      classifyMcpCredential(
        input({ authorization: `Bearer ${FAKE_USER_TOKEN}`, userTokens: false }),
      ),
    ).toEqual({ kind: "none" });
  });

  it("token personal por query sin MCP_ALLOW_QUERY_TOKEN → none", () => {
    expect(classifyMcpCredential(input({ url: `${URL_BASE}?token=${FAKE_USER_TOKEN}` }))).toEqual({
      kind: "none",
    });
  });

  it("basura, prefijo mal formado o nada → none", () => {
    expect(classifyMcpCredential(input({}))).toEqual({ kind: "none" });
    expect(classifyMcpCredential(input({ authorization: "Bearer afj_corto" }))).toEqual({
      kind: "none",
    });
    expect(classifyMcpCredential(input({ authorization: "Bearer otro" }))).toEqual({
      kind: "none",
    });
    // Sin MCP_TOKEN configurado, un token cualquiera no es shared
    expect(
      classifyMcpCredential(input({ authorization: `Bearer ${shared}`, sharedToken: undefined })),
    ).toEqual({ kind: "none" });
  });
});

describe("normalizeMcpTokenLabel (MCP-1)", () => {
  it("recorta, colapsa espacios, saca controles y corta en 60", () => {
    expect(normalizeMcpTokenLabel("  ChatGPT   casa ")).toBe("ChatGPT casa");
    expect(normalizeMcpTokenLabel("Chat\u0000GPT\n")).toBe("ChatGPT");
    expect(normalizeMcpTokenLabel("x".repeat(80))).toHaveLength(MCP_TOKEN_LABEL_MAX);
    expect(normalizeMcpTokenLabel("   ")).toBeNull();
    expect(normalizeMcpTokenLabel(null)).toBeNull();
  });
});

describe("mcpConnectorUrl (MCP-1)", () => {
  it("arma la URL del conector con el origen del sitio", () => {
    expect(mcpConnectorUrl("https://app.example", FAKE_USER_TOKEN)).toBe(
      `https://app.example/api/mcp?token=${FAKE_USER_TOKEN}`,
    );
    expect(mcpConnectorUrl("https://app.example/", FAKE_USER_TOKEN)).toBe(
      `https://app.example/api/mcp?token=${FAKE_USER_TOKEN}`,
    );
  });
});
