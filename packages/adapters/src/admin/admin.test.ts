import { describe, expect, it } from "vitest";
import { maskEmail, parseEmail } from "./common";
import { parseInviteArgs } from "./invite";
import { loadReplayFixture, parseReplayArgs, ReplayFixtureSchema } from "./replay";
import { parseAllowlist, parseTestUsersArgs, readAllowlist } from "./test-users";

describe("maskEmail / parseEmail", () => {
  it("enmascara dejando la primera letra y el dominio", () => {
    expect(maskEmail("lucia@example.com")).toBe("l***@example.com");
  });
  it("lo que no es un email sale como ***", () => {
    expect(maskEmail("sin-arroba")).toBe("***");
    expect(maskEmail("@example.com")).toBe("***");
    expect(maskEmail("ana@")).toBe("***");
  });
  it("parseEmail normaliza y rechaza lo inválido", () => {
    expect(parseEmail("  Ana@Example.COM ")).toBe("ana@example.com");
    expect(parseEmail("no-es-email")).toBeNull();
    expect(parseEmail(undefined)).toBeNull();
  });
});

describe("parseInviteArgs", () => {
  it("--by obligatorio; --email y --remote opcionales", () => {
    expect(parseInviteArgs(["--by", "Admin@Example.com"])).toEqual({
      ok: true,
      by: "admin@example.com",
      email: null,
      remote: false,
    });
    expect(
      parseInviteArgs(["--by", "admin@example.com", "--email", "Nueva@Example.com", "--remote"]),
    ).toEqual({ ok: true, by: "admin@example.com", email: "nueva@example.com", remote: true });
  });
  it("rechaza sin --by, email inválido y opciones desconocidas", () => {
    expect(parseInviteArgs([]).ok).toBe(false);
    expect(parseInviteArgs(["--by", "x"]).ok).toBe(false);
    expect(parseInviteArgs(["--by", "a@example.com", "--email", "x"]).ok).toBe(false);
    expect(parseInviteArgs(["--by", "a@example.com", "--otra"]).ok).toBe(false);
  });
});

describe("parseTestUsersArgs", () => {
  it("--list con defaults", () => {
    expect(parseTestUsersArgs(["--list"])).toEqual({
      ok: true,
      mode: { kind: "list" },
      allowlist: "ops/test-users.txt",
      showEmails: false,
      yes: false,
      remote: false,
    });
  });
  it("--reset con todas las opciones", () => {
    expect(
      parseTestUsersArgs([
        "--reset",
        "Prueba@Example.com",
        "--allowlist",
        "mi.txt",
        "--yes",
        "--remote",
        "--show-emails",
      ]),
    ).toEqual({
      ok: true,
      mode: { kind: "reset", email: "prueba@example.com" },
      allowlist: "mi.txt",
      showEmails: true,
      yes: true,
      remote: true,
    });
  });
  it("exige un modo, no admite los dos y valida el email", () => {
    expect(parseTestUsersArgs([]).ok).toBe(false);
    expect(parseTestUsersArgs(["--list", "--reset", "a@example.com"]).ok).toBe(false);
    expect(parseTestUsersArgs(["--reset", "no-es-email"]).ok).toBe(false);
  });
});

describe("allowlist", () => {
  it("normaliza mayúsculas y espacios, ignora comentarios, vacías y basura, sin duplicar", () => {
    const text =
      "# cuentas de prueba\n  Uno@Example.com  \r\n\ndos@example.com # nota\nbasura\nuno@example.com\n";
    expect(parseAllowlist(text)).toEqual(["uno@example.com", "dos@example.com"]);
  });
  it("inexistente o vacía → error", () => {
    const missing = readAllowlist("nada.txt", { INIT_CWD: "/x" }, () => {
      throw new Error("ENOENT");
    });
    expect(missing.ok).toBe(false);
    const empty = readAllowlist("vacia.txt", { INIT_CWD: "/x" }, () => "# solo comentarios\n\n");
    expect(empty.ok).toBe(false);
  });
  it("resuelve la ruta desde INIT_CWD", () => {
    let seen = "";
    const res = readAllowlist("ops/test-users.txt", { INIT_CWD: "/raiz" }, (p) => {
      seen = p.replace(/\\/g, "/");
      return "a@example.com";
    });
    expect(res).toEqual({ ok: true, emails: ["a@example.com"] });
    expect(seen).toMatch(/\/raiz\/ops\/test-users\.txt$/);
  });
});

describe("parseReplayArgs", () => {
  it("fixture posicional y --to", () => {
    expect(parseReplayArgs(["f.json", "--to", "Ana@Example.com"])).toEqual({
      ok: true,
      fixture: "f.json",
      to: "ana@example.com",
      remote: false,
    });
  });
  it("rechaza sin fixture, sin --to o con posicionales de más", () => {
    expect(parseReplayArgs(["--to", "a@example.com"]).ok).toBe(false);
    expect(parseReplayArgs(["f.json"]).ok).toBe(false);
    expect(parseReplayArgs(["f.json", "g.json", "--to", "a@example.com"]).ok).toBe(false);
  });
});

describe("ReplayFixtureSchema / loadReplayFixture", () => {
  const base = { from: "A <a@example.com>", subject: "Hola" };
  it("acepta html o htmlFile, no ambos ni ninguno", () => {
    expect(ReplayFixtureSchema.safeParse({ ...base, html: "<p>x</p>" }).success).toBe(true);
    expect(ReplayFixtureSchema.safeParse({ ...base, htmlFile: "x.html" }).success).toBe(true);
    expect(ReplayFixtureSchema.safeParse(base).success).toBe(false);
    expect(ReplayFixtureSchema.safeParse({ ...base, html: "x", htmlFile: "y" }).success).toBe(
      false,
    );
  });
  it("rechaza campos desconocidos y faltantes", () => {
    expect(ReplayFixtureSchema.safeParse({ ...base, html: "x", extra: 1 }).success).toBe(false);
    expect(ReplayFixtureSchema.safeParse({ subject: "s", html: "x" }).success).toBe(false);
  });
  it("lee htmlFile relativo al JSON y da error claro con JSON inválido", () => {
    const files: Record<string, string> = {
      "/r/fx/a.json": JSON.stringify({ ...base, htmlFile: "../h/x.html" }),
      "/r/h/x.html": "<p>hola</p>",
      "/r/fx/mal.json": "{no es json",
    };
    const read = (p: string) => {
      const v = files[p.replace(/\\/g, "/").replace(/^[A-Za-z]:/, "")];
      if (v === undefined) throw new Error("ENOENT");
      return v;
    };
    const ok = loadReplayFixture("fx/a.json", { INIT_CWD: "/r" }, read);
    expect(ok).toMatchObject({ ok: true, loaded: { html: "<p>hola</p>" } });
    const bad = loadReplayFixture("fx/mal.json", { INIT_CWD: "/r" }, read);
    expect(bad).toMatchObject({ ok: false, error: expect.stringContaining("JSON") });
  });
});
