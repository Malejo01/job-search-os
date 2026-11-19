import { describe, expect, it, vi } from "vitest";

const logs = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("../logger", () => ({ createLogger: () => ({ error: logs.error }) }));

import { parseLogDays } from "./purge";

describe("parseLogDays · variables de retención", () => {
  it.each([
    ["30", 30],
    [" 90 ", 90],
    ["3650", 3650],
  ])("%j es %i, sin error", (raw, n) => {
    logs.error.mockReset();
    expect(parseLogDays(raw, "INBOUND_RAW_RETENTION_DAYS")).toBe(n);
    expect(logs.error).not.toHaveBeenCalled();
  });

  it("sin valor no hay purga y no es un error", () => {
    logs.error.mockReset();
    expect(parseLogDays(undefined, "INBOUND_RAW_RETENTION_DAYS")).toBeNull();
    expect(parseLogDays("", "INBOUND_RAW_RETENTION_DAYS")).toBeNull();
    expect(logs.error).not.toHaveBeenCalled();
  });

  it.each(["30d", "abc", "0", "3651"])(
    "%j no apaga la purga en silencio: registra un error",
    (raw) => {
      logs.error.mockReset();
      expect(parseLogDays(raw, "INBOUND_RAW_RETENTION_DAYS")).toBeNull();
      expect(logs.error).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(logs.error.mock.calls)).toContain("INBOUND_RAW_RETENTION_DAYS");
    },
  );
});
