import { describe, expect, it } from "vitest";
import { parseRotateInboundArgs, ROTATE_INBOUND_PHRASE } from "./rotate-inbound";

describe("parseRotateInboundArgs", () => {
  it("por defecto solo cuenta y apunta a la base local", () => {
    expect(parseRotateInboundArgs([])).toEqual({ ok: true, apply: false, remote: false });
  });

  it("acepta aplicar y apuntar a la nube", () => {
    expect(parseRotateInboundArgs(["--apply", "--remote"])).toEqual({
      ok: true,
      apply: true,
      remote: true,
    });
  });

  it("rechaza cualquier otro argumento", () => {
    const parsed = parseRotateInboundArgs(["--yes"]);
    expect(parsed.ok).toBe(false);
  });

  it("la frase de confirmación no está vacía", () => {
    expect(ROTATE_INBOUND_PHRASE.trim().length).toBeGreaterThan(0);
  });
});
