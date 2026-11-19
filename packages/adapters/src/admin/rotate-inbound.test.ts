import { describe, expect, it } from "vitest";
import { parseRotateInboundArgs, ROTATE_INBOUND_PHRASE } from "./rotate-inbound";

describe("parseRotateInboundArgs", () => {
  it("por defecto solo cuenta y apunta a la base local", () => {
    expect(parseRotateInboundArgs([])).toMatchObject({ ok: true, apply: false, remote: false });
  });

  it("acepta aplicar y apuntar a la nube", () => {
    expect(parseRotateInboundArgs(["--apply", "--remote"])).toMatchObject({
      ok: true,
      apply: true,
      remote: true,
    });
  });

  it("rechaza cualquier otro argumento", () => {
    const parsed = parseRotateInboundArgs(["--yes"]);
    expect(parsed.ok).toBe(false);
  });

  it("por defecto la gracia es de 7 días y se puede cambiar con --grace-days", () => {
    expect(parseRotateInboundArgs([])).toMatchObject({ ok: true, graceDays: 7 });
    expect(parseRotateInboundArgs(["--grace-days=14"])).toMatchObject({ ok: true, graceDays: 14 });
  });

  it.each(["--grace-days=0", "--grace-days=abc", "--grace-days=400", "--grace-days="])(
    "rechaza %s",
    (arg) => {
      expect(parseRotateInboundArgs([arg]).ok).toBe(false);
    },
  );

  it("la frase de confirmación no está vacía", () => {
    expect(ROTATE_INBOUND_PHRASE.trim().length).toBeGreaterThan(0);
  });
});
