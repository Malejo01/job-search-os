import { describe, expect, it } from "vitest";
// apps/web no tiene runner propio: la parte pura se prueba desde acá (como terms.test.ts).
import { buildRequestErrorLog, stripQuery } from "../../../apps/web/lib/request-error-log";

const ctx = { routeType: "render", routerKind: "App Router", routePath: "/jobs/[id]" };

describe("log de errores de request", () => {
  it("no deja salir message, stack, cause, headers ni query", () => {
    const err = Object.assign(new Error("texto de una JD Empresa A"), {
      digest: "1234567890",
      cause: { code: "57014", message: "select ... where email = 'x@y.z'" },
    });
    const out = buildRequestErrorLog(
      err,
      { path: "/jobs/abc?token=secreto&q=otro", method: "GET", headers: { cookie: "s" } } as never,
      ctx,
    );
    const json = JSON.stringify(out);
    expect(json).not.toContain("JD");
    expect(json).not.toContain("secreto");
    expect(json).not.toContain("select");
    expect(json).not.toContain("cookie");
    expect(json).not.toContain("stack");
    expect(out).toEqual({
      errorName: "Error",
      digest: "1234567890",
      code: "57014",
      path: "/jobs/abc",
      method: "GET",
      routeType: "render",
      routerKind: "App Router",
      routePath: "/jobs/[id]",
    });
  });

  it("tolera valores que no son errores y descarta códigos con texto libre", () => {
    const out = buildRequestErrorLog(
      { name: "Mal nombre con espacios", code: "texto libre con datos" },
      { path: "/x", method: "POST" },
      ctx,
    );
    expect(out.errorName).toBe("Error");
    expect(out.code).toBeUndefined();
    expect(buildRequestErrorLog("boom", { path: "/x", method: "GET" }, ctx).errorName).toBe(
      "Error",
    );
    expect(stripQuery("/a#frag")).toBe("/a");
  });
});
