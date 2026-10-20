import { describe, expect, it } from "vitest";
import { parseCronArgs, resolveCronTarget } from "./target";

const URL_FICTICIA = "postgres://servidor-remoto.invalid/appdb";

describe("parseCronArgs", () => {
  it("ingest y market, local por defecto", () => {
    expect(parseCronArgs(["ingest"])).toEqual({ ok: true, job: "ingest", remote: false });
    expect(parseCronArgs(["market", "--local"])).toEqual({
      ok: true,
      job: "market",
      remote: false,
    });
  });

  it("--remote en cualquier posición", () => {
    expect(parseCronArgs(["--remote", "ingest"])).toEqual({
      ok: true,
      job: "ingest",
      remote: true,
    });
  });

  it("falta el job, job desconocido, flags juntos o flag desconocido: error con el uso", () => {
    for (const argv of [
      [],
      ["--remote"],
      ["otro"],
      ["ingest", "--local", "--remote"],
      ["ingest", "--x"],
    ]) {
      const r = parseCronArgs(argv);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("uso: pnpm cron:run");
    }
  });

  it("dos jobs: error", () => {
    expect(parseCronArgs(["ingest", "market"]).ok).toBe(false);
  });
});

describe("resolveCronTarget", () => {
  it("local: usa DATABASE_URL_LOCAL o la base de Docker", () => {
    const def = resolveCronTarget({ remote: false, env: {} });
    expect(def.ok).toBe(true);
    if (def.ok) expect(def.label).toMatch(/^local \(/);
    const custom = resolveCronTarget({
      remote: false,
      env: { DATABASE_URL_LOCAL: "postgres://a:b@localhost:5432/otra" },
    });
    expect(custom).toMatchObject({ ok: true, url: "postgres://a:b@localhost:5432/otra" });
  });

  it("local: rechaza una base que no es de esta máquina, sin filtrar la URL", () => {
    const r = resolveCronTarget({ remote: false, env: { DATABASE_URL_LOCAL: URL_FICTICIA } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("no es de esta máquina");
      expect(r.error).not.toContain("host.invalid");
      expect(r.error).not.toContain(URL_FICTICIA);
    }
  });

  it("remoto: solo dentro de GitHub Actions", () => {
    const r = resolveCronTarget({ remote: true, env: { DATABASE_URL: URL_FICTICIA } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("solo corre dentro de GitHub Actions");
      expect(r.error).not.toContain("host.invalid");
    }
    expect(
      resolveCronTarget({
        remote: true,
        env: { DATABASE_URL: URL_FICTICIA, GITHUB_ACTIONS: "false" },
      }).ok,
    ).toBe(false);
  });

  it("remoto: falta o vacío el secret DATABASE_URL", () => {
    for (const env of [{ GITHUB_ACTIONS: "true" }, { GITHUB_ACTIONS: "true", DATABASE_URL: "" }]) {
      const r = resolveCronTarget({ remote: true, env });
      expect(r).toEqual({ ok: false, error: "falta el secret DATABASE_URL" });
    }
  });

  it("remoto en Actions: label sin host ni URL", () => {
    const r = resolveCronTarget({
      remote: true,
      env: { GITHUB_ACTIONS: "true", DATABASE_URL: URL_FICTICIA },
    });
    expect(r).toEqual({ ok: true, url: URL_FICTICIA, label: "remoto" });
    if (r.ok) {
      expect(r.label).not.toContain("host.invalid");
      expect(r.label).not.toContain("alias:clave");
    }
  });
});
