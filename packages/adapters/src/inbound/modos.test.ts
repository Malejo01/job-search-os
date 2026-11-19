import { beforeEach, describe, expect, it, vi } from "vitest";

const logger = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() });

/** Cada test arranca un proceso nuevo: el aviso es de una sola vez por proceso. */
async function load() {
  vi.resetModules();
  return import("./handle");
}

// Cargar `handle` de cero es pesado: la primera carga de cada test puede pasar de 5 s
describe("lectura de los modos del correo entrante", { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(["ENFORCE", " enforce ", "Enforce"])("INBOUND_SIZE_MODE=%j es enforce", async (raw) => {
    const { readInboundSizeMode } = await load();
    const log = logger();
    expect(readInboundSizeMode(raw, log)).toBe("enforce");
    expect(log.error).not.toHaveBeenCalled();
  });

  it("INBOUND_SIZE_MODE desconocido usa log y registra un error una sola vez", async () => {
    const { readInboundSizeMode } = await load();
    const log = logger();
    expect(readInboundSizeMode("enforced", log)).toBe("log");
    expect(readInboundSizeMode("enforced", log)).toBe("log");
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.error.mock.calls)).toContain("INBOUND_SIZE_MODE");
  });

  it("INBOUND_DMARC_MODE desconocido usa log y registra un error una sola vez", async () => {
    const { readInboundDmarcMode } = await load();
    const log = logger();
    expect(readInboundDmarcMode("enforced", log)).toBe("log");
    expect(readInboundDmarcMode("enforced", log)).toBe("log");
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.error.mock.calls)).toContain("INBOUND_DMARC_MODE");
  });

  it.each(["ENFORCE", " enforce "])("INBOUND_DMARC_MODE=%j es enforce", async (raw) => {
    const { readInboundDmarcMode } = await load();
    const log = logger();
    expect(readInboundDmarcMode(raw, log)).toBe("enforce");
    expect(log.error).not.toHaveBeenCalled();
  });

  it("sin la variable es log, sin error", async () => {
    const { readInboundSizeMode, readInboundDmarcMode } = await load();
    const log = logger();
    expect(readInboundSizeMode(undefined, log)).toBe("log");
    expect(readInboundDmarcMode(undefined, log)).toBe("log");
    expect(log.error).not.toHaveBeenCalled();
  });
});
