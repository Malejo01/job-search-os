import { describe, expect, it, vi } from "vitest";
import { confirmRemoteTarget, isRemoteDatabase } from "./confirm-remote";

/**
 * Salvaguarda de db:migrate y db:seed (2026-09-22): el destino por defecto es la nube, y una
 * migración pensada para Docker terminó en producción. Contra una base remota ahora hay que
 * confirmar escribiendo "si"; sin terminal para preguntar, no corre.
 */
const NEON = "postgres://dueño:x@ep-algo-123.sa-east-1.aws.neon.tech/jobsearch";
const LOCAL = "postgres://postgres:postgres@localhost:54322/jobsearch";

describe("isRemoteDatabase", () => {
  it.each([
    [LOCAL, false],
    ["postgres://u:p@127.0.0.1:5432/db", false],
    ["postgres://u:p@[::1]:5432/db", false],
    ["postgres://u:p@host.docker.internal:5432/db", false],
    [NEON, true],
    ["postgres://u:p@db.example.com:5432/db", true],
    ["no es una url", true],
  ])("%s → %s", (url, remote) => {
    expect(isRemoteDatabase(url)).toBe(remote);
  });
});

describe("confirmRemoteTarget", () => {
  const base = { action: "migrar", env: {}, interactive: true, log: () => {} };

  it("una base local no pregunta nada (CI y Docker siguen igual)", async () => {
    const ask = vi.fn();
    expect(await confirmRemoteTarget(LOCAL, { ...base, ask })).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it("contra producción pregunta y solo sigue con «si»", async () => {
    const ask = vi.fn(async () => "si");
    expect(await confirmRemoteTarget(NEON, { ...base, ask })).toBe(true);
    expect(ask).toHaveBeenCalledWith(expect.stringContaining("Vas a migrar PRODUCCIÓN"));
    expect(ask).toHaveBeenCalledWith(
      expect.stringContaining("ep-algo-123.sa-east-1.aws.neon.tech"),
    );
    expect(await confirmRemoteTarget(NEON, { ...base, ask: async () => " SI " })).toBe(true);
  });

  it("cualquier otra respuesta cancela", async () => {
    for (const answer of ["", "s", "sí", "yes", "no"]) {
      expect(await confirmRemoteTarget(NEON, { ...base, ask: async () => answer })).toBe(false);
    }
  });

  it("sin terminal (un agente, un script) no corre contra producción", async () => {
    const ask = vi.fn();
    const log = vi.fn();
    expect(await confirmRemoteTarget(NEON, { ...base, interactive: false, ask, log })).toBe(false);
    expect(ask).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("CONFIRM_PRODUCTION=si"));
  });

  it("CONFIRM_PRODUCTION=si confirma sin preguntar (decisión explícita de quien lo corre)", async () => {
    const ask = vi.fn();
    expect(
      await confirmRemoteTarget(NEON, {
        ...base,
        interactive: false,
        env: { CONFIRM_PRODUCTION: "si" },
        ask,
      }),
    ).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });
});
