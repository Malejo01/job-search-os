import { describe, expect, it } from "vitest";
import { checkMcpToken } from "./auth";

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
