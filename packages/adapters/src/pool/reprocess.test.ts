import { describe, expect, it } from "vitest";
import { parseReprocessArgs, REPROCESS_DEFAULT_LIMIT, REPROCESS_MAX_LIMIT } from "./reprocess";

describe("parseReprocessArgs", () => {
  it("por defecto: tope chico, escribe, local", () => {
    expect(parseReprocessArgs([])).toEqual({
      ok: true,
      limit: REPROCESS_DEFAULT_LIMIT,
      dryRun: false,
      includeFailed: false,
      remote: false,
    });
    expect(REPROCESS_DEFAULT_LIMIT).toBeLessThanOrEqual(50);
  });

  it("acepta las banderas y un tope válido", () => {
    expect(
      parseReprocessArgs(["--limit", "5", "--dry-run", "--include-failed", "--remote"]),
    ).toEqual({ ok: true, limit: 5, dryRun: true, includeFailed: true, remote: true });
  });

  it("rechaza topes fuera de rango, no numéricos o sin valor, y banderas desconocidas", () => {
    for (const bad of [
      ["--limit"],
      ["--limit", "0"],
      ["--limit", "-3"],
      ["--limit", "abc"],
      ["--limit", "1.5"],
      ["--limit", String(REPROCESS_MAX_LIMIT + 1)],
      ["--apply"],
      ["5"],
    ]) {
      expect(parseReprocessArgs(bad).ok, bad.join(" ")).toBe(false);
    }
  });
});
