import { describe, expect, it } from "vitest";
import { isInternalPath } from "../lib/internal-path";

describe("isInternalPath", () => {
  it.each(["/", "/ok", "/cv/perfil?paso=2", "/settings#puesto"])("acepta %s", (path) => {
    expect(isInternalPath(path)).toBe(true);
  });

  it.each([
    "//x",
    "/\\x",
    "https://x",
    "http://x",
    "javascript:alert(1)",
    "ok",
    "",
    " /ok",
    "/\t/x",
    "/\n/x",
    "/\r/x",
    "/\u0000/x",
    "/\u007f/x",
  ])("rechaza %j", (path) => {
    expect(isInternalPath(path)).toBe(false);
  });

  it.each([null, undefined, 1, {}, ["/ok"]])("rechaza lo que no es texto: %j", (path) => {
    expect(isInternalPath(path)).toBe(false);
  });
});
