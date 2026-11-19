import { describe, expect, it } from "vitest";
import { readIntegerSetting, readMode } from "./env-modes";
import { parseInboundDmarcMode } from "./from-address";

const MODES = ["log", "enforce"] as const;

describe("readMode", () => {
  it.each(["enforce", "ENFORCE", " enforce ", "Enforce", "\tenforce\n"])(
    "%j se lee como enforce, sin error",
    (raw) => {
      expect(readMode("INBOUND_SIZE_MODE", raw, MODES, "log")).toEqual({
        value: "enforce",
        error: null,
      });
    },
  );

  it.each([undefined, "", "   "])("%j es el valor por defecto, sin error", (raw) => {
    expect(readMode("INBOUND_SIZE_MODE", raw, MODES, "log")).toEqual({ value: "log", error: null });
  });

  it.each(["enforced", "habilitado", "true", "enforce!", "off"])(
    "%j es desconocido: valor por defecto y un error con el nombre de la variable",
    (raw) => {
      const out = readMode("INBOUND_SIZE_MODE", raw, MODES, "log");
      expect(out.value).toBe("log");
      expect(out.error).toContain("INBOUND_SIZE_MODE");
      expect(out.error).toContain("log, enforce");
      // El valor mal escrito no se copia al mensaje
      expect(out.error).not.toContain(raw.trim() || "\u0000");
    },
  );
});

describe("readIntegerSetting", () => {
  it.each([
    ["30", 30],
    [" 90 ", 90],
    ["3650", 3650],
  ])("%j es %i", (raw, n) => {
    expect(readIntegerSetting("INBOUND_RAW_RETENTION_DAYS", raw, 1, 3650)).toEqual({
      value: n,
      error: null,
    });
  });

  it.each([undefined, "", "  "])("%j es ausente: sin valor y sin error", (raw) => {
    expect(readIntegerSetting("INBOUND_RAW_RETENTION_DAYS", raw, 1, 3650)).toEqual({
      value: null,
      error: null,
    });
  });

  it.each(["30d", "abc", "0", "-5", "3651", "1.5", "1e2"])(
    "%j no es válido: sin valor y con un error",
    (raw) => {
      const out = readIntegerSetting("INBOUND_RAW_RETENTION_DAYS", raw, 1, 3650);
      expect(out.value).toBeNull();
      expect(out.error).toContain("INBOUND_RAW_RETENTION_DAYS");
      expect(out.error).toContain("1 a 3650");
    },
  );
});

describe("parseInboundDmarcMode con el lector único", () => {
  it.each([
    ["ENFORCE", "enforce"],
    [" Off ", "off"],
    ["enforced", "log"],
    [undefined, "log"],
  ])("%j da %s", (raw, mode) => {
    expect(parseInboundDmarcMode(raw)).toBe(mode);
  });
});
